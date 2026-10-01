import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __setLogTestSink,
  saveAccounts,
  setLogLevel,
} from '@cortexkit/anthropic-auth-core'
import { type Message, normalizeContext } from '@earendil-works/pi-ai'
import { buildAnthropicRequest } from '../convert.ts'
import { streamCortexKitAnthropic } from '../stream.ts'

const user = (content: any): Message => ({
  role: 'user',
  content,
  timestamp: 0,
})
const answer = {
  role: 'assistant',
  content: [{ type: 'text', text: 'Prior answer' }],
  timestamp: 0,
} as Message
const prompt =
  'Stable instructions.\n\nPi documentation: synthetic documentation.'
const tools = [
  {
    name: 'read',
    description: 'Read',
    parameters: { type: 'object', properties: {} },
  },
]
const context = (messages: Message[]) =>
  normalizeContext({ systemPrompt: prompt, tools, messages })
// Only protocol locations count. Tool schemas/arguments can themselves contain cache_control.
function markers(body: any): any[] {
  return [
    body,
    ...(body.tools ?? []),
    ...(body.system ?? []),
    ...body.messages.flatMap((m: any) => [
      m,
      ...(Array.isArray(m.content) ? m.content : []),
    ]),
  ].filter((block) => block.cache_control)
}
const modes = [
  { enabled: false, mode: 'explicit' as const },
  { enabled: true, mode: 'explicit' as const },
  { enabled: true, mode: 'hybrid' as const },
  { enabled: true, mode: 'automatic' as const },
]

describe('serialized conversation cache coverage', () => {
  for (const cache of modes) {
    test(`${cache.enabled ? '1h' : '5m'} ${cache.mode}: later text and notification turns retain cache coverage`, async () => {
      for (const content of [
        'Follow-up',
        [{ type: 'text', text: 'Subagent notification' }],
      ]) {
        const transcript = context([user('First turn'), answer, user(content)])
        const before = JSON.stringify(transcript)
        const { bodyText } = await buildAnthropicRequest(
          'claude-opus-5-5',
          transcript,
          { reasoning: 'medium' },
          cache,
        )
        const body = JSON.parse(bodyText)
        expect(JSON.stringify(transcript)).toBe(before)
        expect(markers(body).length).toBeLessThanOrEqual(4)
        const expected = cache.enabled
          ? { type: 'ephemeral', ttl: '1h' }
          : { type: 'ephemeral' }
        if (cache.enabled && cache.mode === 'automatic') {
          expect(body.cache_control).toEqual(expected)
          expect(markers(body)).toHaveLength(1)
        } else {
          expect(body.messages.at(-1).content.at(-1).cache_control).toEqual(
            expected,
          )
          expect(markers(body)).toHaveLength(4)
        }
      }
    })
  }

  test('user block representation remains stable as history grows', async () => {
    const build = async (messages: Message[]) =>
      JSON.parse(
        (
          await buildAnthropicRequest(
            'claude-opus-5-5',
            context(messages),
            undefined,
            modes[0]!,
          )
        ).bodyText,
      )
    const first = await build([
      user('First'),
      answer,
      user([{ type: 'text', text: 'Second' }]),
    ])
    const next = await build([
      user('First'),
      answer,
      user([{ type: 'text', text: 'Second' }]),
      answer,
      user('Third'),
    ])
    const withoutMarkers = (value: any): any =>
      JSON.parse(
        JSON.stringify(value, (key, v) =>
          key === 'cache_control' ? undefined : v,
        ),
      )
    expect(
      withoutMarkers(next.messages.slice(0, first.messages.length)),
    ).toEqual(withoutMarkers(first.messages))
    expect(Array.isArray(first.messages.at(-1).content)).toBe(true)
  })

  test('empty user blocks are skipped rather than becoming invalid cache targets', async () => {
    const { bodyText } = await buildAnthropicRequest(
      'claude-opus-5-5',
      context([
        user('First'),
        answer,
        user([{ type: 'text', text: '' }]),
        user([]),
        user(''),
      ]),
      undefined,
      modes[0]!,
    )
    const body = JSON.parse(bodyText)
    expect(body.messages).toHaveLength(1) // same empty-user/prefill policy as string messages
    expect(body.messages[0].content.at(-1).text).toBe('First')
    expect(markers(body).some((m) => m.type === 'text' && !m.text.trim())).toBe(
      false,
    )
  })

  test('images and complete tool turns preserve content and cache the final eligible block', async () => {
    const call = {
      role: 'assistant',
      provider: 'anthropic',
      api: 'cortexkit-anthropic-messages',
      model: 'claude-opus-5-5',
      timestamp: 0,
      content: [
        {
          type: 'thinking',
          thinking: 'reason',
          thinkingSignature: 'signed-fixture',
        },
        {
          type: 'toolCall',
          id: 'call_1',
          name: 'read',
          arguments: { cache_control: 'ordinary argument' },
        },
      ],
    } as Message
    const result = {
      role: 'toolResult',
      toolCallId: 'call_1',
      content: [{ type: 'text', text: 'Result' }],
      timestamp: 0,
    } as Message
    const image = { type: 'image', mimeType: 'image/png', data: 'c3ludGhldGlj' }
    const { bodyText } = await buildAnthropicRequest(
      'claude-opus-5-5',
      context([
        user('First'),
        call,
        result,
        user([
          { type: 'text', text: 'See image' },
          image,
          { type: 'text', text: '' },
        ]),
      ]),
      undefined,
      modes[1]!,
    )
    const body = JSON.parse(bodyText)
    expect(body.messages[1].content[0]).toEqual({
      type: 'thinking',
      thinking: 'reason',
      signature: 'signed-fixture',
    })
    expect(body.messages[1].content[1].input).toEqual({
      cache_control: 'ordinary argument',
    })
    expect(body.messages[2].content[0].type).toBe('tool_result')
    expect(body.messages.at(-1).content.at(-1)).toMatchObject({
      type: 'image',
      source: { data: image.data },
      cache_control: { type: 'ephemeral', ttl: '1h' },
    })
  })
})

const originalFetch = globalThis.fetch
let directory: string | undefined
afterEach(async () => {
  globalThis.fetch = originalFetch
  __setLogTestSink(null)
  setLogLevel('info')
  delete process.env.PI_ANTHROPIC_AUTH_FILE
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('stream cache accounting and diagnostics', () => {
  test.each([
    [
      '5m',
      { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 },
      0.0015,
      'response-ttl',
    ],
    [
      '1h',
      { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 300 },
      0.0024,
      'response-ttl',
    ],
    ['missing split', undefined, 0.0024, 'catalog-estimate'],
    [
      'incomplete split',
      { ephemeral_5m_input_tokens: 100 },
      0.0024,
      'catalog-estimate',
    ],
    [
      'inconsistent split',
      { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 100 },
      0.0024,
      'catalog-estimate',
    ],
  ] as const)(
    '%s accounting remains honest after a partial stream failure',
    async (_name, split, expectedWriteCost, pricing) => {
      directory = await mkdtemp(join(tmpdir(), 'pi-cache-accounting-'))
      process.env.PI_ANTHROPIC_AUTH_FILE = join(directory, 'accounts.json')
      const logs: any[] = []
      __setLogTestSink((record) => logs.push(record))
      globalThis.fetch = (async () =>
        new Response(
          [
            {
              type: 'message_start',
              message: {
                usage: {
                  input_tokens: 2,
                  cache_creation_input_tokens: 300,
                  cache_creation: split,
                },
              },
            },
            { type: 'message_delta', usage: { output_tokens: 7 } },
            {
              type: 'error',
              error: { type: 'overloaded_error', message: 'synthetic failure' },
            },
          ]
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(''),
        )) as unknown as typeof fetch
      const model = {
        id: 'claude-opus-5-5',
        api: 'cortexkit-anthropic-messages',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 },
      } as any
      const events: any[] = []
      for await (const event of streamCortexKitAnthropic(
        model,
        context([user('accounting')]),
        { apiKey: 'synthetic-token' },
      ))
        events.push(event)
      expect(events.filter((e) => e.type === 'done')).toEqual([])
      const failures = events.filter((e) => e.type === 'error')
      expect(failures).toHaveLength(1)
      expect(failures[0].error.usage.cost.cacheWrite).toBeCloseTo(
        expectedWriteCost,
        10,
      )
      expect(failures[0].error.usage).toMatchObject({
        input: 2,
        output: 7,
        cacheWrite: 300,
      })
      expect(
        logs.find((r) => r.message === 'response cache usage')?.payload
          .writePricing,
      ).toBe(pricing)
    },
  )

  test('serialized 1h coverage, mixed TTL cost, partial SSE usage and content-free diagnostics', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pi-cache-wire-'))
    const path = join(directory, 'accounts.json')
    process.env.PI_ANTHROPIC_AUTH_FILE = path
    await saveAccounts(
      {
        version: 1,
        main: { type: 'opencode', provider: 'anthropic' },
        accounts: [],
        claudeCache: { enabled: true, mode: 'explicit' },
      },
      path,
    )
    const logs: any[] = []
    __setLogTestSink((record) => logs.push(record))
    setLogLevel('debug')
    let captured: any
    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toContain('/v1/messages')
      captured = JSON.parse(String(init?.body))
      const events = [
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 2,
              output_tokens: 0,
              cache_read_input_tokens: 10000,
              cache_creation_input_tokens: 300,
              cache_creation: {
                ephemeral_5m_input_tokens: 100,
                ephemeral_1h_input_tokens: 200,
              },
            },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'ok' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 7 },
        },
        { type: 'message_stop' },
      ]
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
        { headers: { 'request-id': 'synthetic-request' } },
      )
    }) as typeof fetch
    const model = {
      id: 'claude-opus-5-5',
      api: 'cortexkit-anthropic-messages',
      provider: 'anthropic',
      name: 'Opus',
      baseUrl: 'https://api.anthropic.com',
      reasoning: true,
      input: ['text'],
      contextWindow: 1000000,
      maxTokens: 128000,
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 },
    } as any
    const events: any[] = []
    for await (const event of streamCortexKitAnthropic(
      model,
      context([user('PRIVATE_PROMPT_SENTINEL'), answer, user('notification')]),
      { apiKey: 'synthetic-token' },
    ))
      events.push(event)
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(captured.messages.at(-1).content.at(-1).cache_control).toEqual({
      type: 'ephemeral',
      ttl: '1h',
    })
    const usage = events.find((e) => e.type === 'done').message.usage
    expect(usage).toMatchObject({
      input: 2,
      output: 7,
      cacheRead: 10000,
      cacheWrite: 300,
      totalTokens: 10309,
    })
    expect(usage.cost.cacheWrite).toBeCloseTo(0.0021, 10)
    expect(usage.cost.total).toBeCloseTo(0.004248, 10)
    expect(model.cost.cacheWrite).toBe(8)
    expect(
      logs.some(
        (r) =>
          r.channel === 'pi-cache' && r.payload?.conversationCached === true,
      ),
    ).toBe(true)
    expect(
      logs.some(
        (r) =>
          r.channel === 'pi-cache' &&
          r.payload?.cacheWrite5m === 100 &&
          r.payload?.cacheWrite1h === 200,
      ),
    ).toBe(true)
    expect(JSON.stringify(logs)).not.toContain('PRIVATE_PROMPT_SENTINEL')
    expect(JSON.stringify(logs)).not.toContain('synthetic-token')
  })
})
