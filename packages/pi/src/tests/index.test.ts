import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveAccounts } from '@cortexkit/anthropic-auth-core'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import cortexKitPiAnthropicAuth from '../index'
import {
  ANTHROPIC_SDK_MODELS,
  buildCortexKitAnthropicModels,
} from '../model-catalog'

let tempDir: string | undefined
const originalFetch = globalThis.fetch

// Fable 5.1 is the family that carries mid-conversation effort markers, so it
// is the model that can observe what turn_start collected.
const fableModel = {
  id: 'claude-fable-5-1',
  name: 'Claude Fable 5.1',
  api: 'cortexkit-anthropic-messages',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  reasoning: true,
  input: ['text'],
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
  contextWindow: 1_000_000,
  maxTokens: 128_000,
}
const messagesUrl = `${fableModel.baseUrl}/v1/messages`

afterEach(async () => {
  globalThis.fetch = originalFetch
  delete process.env.PI_ANTHROPIC_AUTH_FILE
  if (tempDir) await rm(tempDir, { recursive: true, force: true })
  tempDir = undefined
})

function mockPi() {
  const providers = new Map<
    string,
    {
      models?: Array<Record<string, unknown>>
      streamSimple?: (...args: any[]) => unknown
    }
  >()
  const events = new Map<string, (...args: any[]) => unknown>()

  const pi = {
    registerCommand: () => {},
    registerProvider: (
      name: string,
      config: {
        models?: Array<Record<string, unknown>>
        streamSimple?: (...args: any[]) => unknown
      },
    ) => {
      providers.set(name, config)
    },
    on: (name: string, handler: (...args: any[]) => unknown) => {
      events.set(name, handler)
    },
  } as unknown as ExtensionAPI

  return { pi, providers, events }
}

describe('cortexKitPiAnthropicAuth provider registration', () => {
  test('uses the concise CortexKit provider label', async () => {
    const { pi, providers } = mockPi()

    await cortexKitPiAnthropicAuth(pi)

    expect(providers.get('anthropic')).toMatchObject({
      name: 'Anthropic (CortexKit)',
      api: 'cortexkit-anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
    })
  })

  test('exposes Claude Sonnet 5 in the Pi Anthropic catalog', async () => {
    const { pi, providers } = mockPi()

    await cortexKitPiAnthropicAuth(pi)

    const anthropic = providers.get('anthropic')
    expect(anthropic).toBeDefined()

    const sonnet5 = anthropic?.models?.find(
      (model) => model.id === 'claude-sonnet-5',
    )
    expect(sonnet5).toMatchObject({
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    })
  })

  test('exposes Claude Sonnet 5.5 with native limits and prices', async () => {
    const { pi, providers } = mockPi()
    await cortexKitPiAnthropicAuth(pi)

    const sonnet55 = providers
      .get('anthropic')
      ?.models?.find((model) => model.id === 'claude-sonnet-5-5')
    expect(sonnet55).toMatchObject({
      id: 'claude-sonnet-5-5',
      name: 'Claude Sonnet 5.5',
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        xhigh: 'xhigh',
        max: 'max',
      },
      input: ['text', 'image'],
      cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    })
  })

  test('exposes Claude Fable and Mythos 5.1 in the Pi Anthropic catalog', async () => {
    const { pi, providers } = mockPi()

    await cortexKitPiAnthropicAuth(pi)

    const models = providers.get('anthropic')?.models ?? []
    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'claude-fable-5-1',
          name: 'Claude Fable 5.1',
          reasoning: true,
          cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
          contextWindow: 1_000_000,
          maxTokens: 128_000,
        }),
        expect.objectContaining({
          id: 'claude-mythos-5-1',
          name: 'Claude Mythos 5.1',
          reasoning: true,
          cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
          contextWindow: 1_000_000,
          maxTokens: 128_000,
        }),
      ]),
    )
  })

  test('exposes Claude Opus 5.5 in the Pi Anthropic catalog', async () => {
    const { pi, providers } = mockPi()

    await cortexKitPiAnthropicAuth(pi)

    const opus55 = providers
      .get('anthropic')
      ?.models?.find((model) => model.id === 'claude-opus-5-5')
    expect(opus55).toMatchObject({
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      reasoning: true,
      thinkingLevelMap: {
        off: null,
        minimal: null,
        low: 'low',
        medium: 'medium',
        high: 'high',
        xhigh: 'xhigh',
        max: 'max',
      },
      input: ['text', 'image'],
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    })
    expect(
      getSupportedThinkingLevels(
        opus55! as unknown as Parameters<typeof getSupportedThinkingLevels>[0],
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])

    const { buildAnthropicRequest } = await import('../convert.ts')
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const { body } = await buildAnthropicRequest(
        'claude-opus-5-5',
        { messages: [], systemPrompt: '', tools: [] } as any,
        { reasoning: effort } as any,
        { enabled: false, mode: 'explicit' },
      )
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(body.output_config).toEqual({ effort })
    }
  })

  test('exposes Claude Opus 5 in the Pi Anthropic catalog', async () => {
    const { pi, providers } = mockPi()

    await cortexKitPiAnthropicAuth(pi)

    const opus5 = providers
      .get('anthropic')
      ?.models?.find((model) => model.id === 'claude-opus-5')
    expect(
      getSupportedThinkingLevels(
        opus5! as unknown as Parameters<typeof getSupportedThinkingLevels>[0],
      ),
    ).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(opus5).toMatchObject({
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      contextWindow: 1_000_000,
      maxTokens: 128_000,
    })
  })
})

describe('SDK-backed Anthropic model catalog', () => {
  const expectedIds = [
    'claude-fable-5',
    'claude-fable-5-1',
    'claude-haiku-4-5',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-5',
    'claude-opus-4-5-20251101',
    'claude-opus-4-8',
    'claude-opus-5',
    'claude-opus-5-5',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-20250929',
    'claude-sonnet-5',
    'claude-sonnet-5-5',
    'claude-mythos-5',
    'claude-mythos-5-1',
  ]

  test('registers exact SDK names and IDs under CortexKit api and preserves SDK metadata', async () => {
    const original = structuredClone(ANTHROPIC_SDK_MODELS)
    const { pi, providers } = mockPi()
    await cortexKitPiAnthropicAuth(pi)
    const models = providers.get('anthropic')?.models ?? []

    expect(models.map((model) => model.id)).toEqual(expectedIds)
    expect(new Set(models.map((model) => model.id)).size).toBe(models.length)
    expect(
      models.every((model) => model.api === 'cortexkit-anthropic-messages'),
    ).toBe(true)
    expect(
      models.find((model) => model.id === 'claude-haiku-4-5'),
    ).toMatchObject({
      name: 'Claude Haiku 4.5 (latest)',
      reasoning: true,
    })
    expect(
      models.find((model) => model.id === 'claude-haiku-4-5-20251001'),
    ).toMatchObject({
      name: 'Claude Haiku 4.5',
    })
    for (const sdkModel of original) {
      const registered = models.find((model) => model.id === sdkModel.id)
      if (registered) {
        const {
          api: _api,
          baseUrl: _baseUrl,
          thinkingLevelMap: _adaptedThinkingLevelMap,
          ...metadata
        } = registered
        const {
          api: _sdkApi,
          baseUrl: _sdkBaseUrl,
          thinkingLevelMap: _sdkThinkingLevelMap,
          ...sdkMetadata
        } = sdkModel
        expect(metadata).toEqual({ ...sdkMetadata, provider: 'anthropic' })
      }
    }
    expect(ANTHROPIC_SDK_MODELS).toEqual(original)
  })

  test('excludes unproven adaptive converter branches and follows synthetic SDK additions/removals', () => {
    const sdk = anthropicProvider().getModels()
    const excludedIds = [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ]
    const projected = buildCortexKitAnthropicModels(sdk)
    expect(projected.map(({ id }) => id)).not.toEqual(
      expect.arrayContaining(excludedIds),
    )

    const datedHaiku = sdk.find(({ id }) => id === 'claude-haiku-4-5-20251001')!
    const withoutHaiku = sdk.filter(({ id }) => id !== datedHaiku.id)
    expect(
      buildCortexKitAnthropicModels(withoutHaiku).some(
        ({ id }) => id === datedHaiku.id,
      ),
    ).toBe(false)
    expect(
      buildCortexKitAnthropicModels([...withoutHaiku, datedHaiku]).some(
        ({ id }) => id === datedHaiku.id,
      ),
    ).toBe(true)
    expect(
      buildCortexKitAnthropicModels(
        sdk.filter(({ id }) => id !== 'claude-sonnet-5'),
      ).some(({ id }) => id === 'claude-sonnet-5'),
    ).toBe(false)
  })

  test('adaptive SDK models are excluded when CortexKit captures token-budget thinking instead', async () => {
    const { buildAnthropicRequest } = await import('../convert.ts')
    const sdkProvider = anthropicProvider()
    for (const id of [
      'claude-opus-4-6',
      'claude-opus-4-7',
      'claude-sonnet-4-6',
    ]) {
      const sdkModel = sdkProvider.getModels().find((model) => model.id === id)!
      let sdkPayload: Record<string, any> | undefined
      const events = sdkProvider.streamSimple(
        sdkModel,
        { messages: [] } as any,
        {
          apiKey: 'no-network-capture',
          reasoning: 'high',
          onPayload: (payload: unknown) => {
            sdkPayload = payload as Record<string, any>
            throw new Error('capture complete')
          },
        } as any,
      )
      for await (const _event of events) {
        /* consume the local capture */
      }
      const converted = await buildAnthropicRequest(
        id,
        { messages: [], systemPrompt: '', tools: [] } as any,
        { reasoning: 'high' } as any,
        { enabled: false, mode: 'explicit' },
      )
      expect(sdkPayload?.thinking?.type).toBe('adaptive')
      expect(converted.body.thinking?.type).toBe('enabled')
      expect(converted.body.output_config).toBeUndefined()
    }
  })

  test('re-registration is deterministic and provider registration cannot mutate SDK models', async () => {
    const before = structuredClone(ANTHROPIC_SDK_MODELS)
    const { pi, providers } = mockPi()
    await cortexKitPiAnthropicAuth(pi)
    const first = structuredClone(providers.get('anthropic')?.models)
    const firstModels = providers.get('anthropic')?.models ?? []
    if (firstModels[0]) firstModels[0].name = 'host mutation'
    await cortexKitPiAnthropicAuth(pi)
    expect(providers.get('anthropic')?.models).toEqual(first)
    expect(ANTHROPIC_SDK_MODELS).toEqual(before)
  })

  test('every projected model sends distinct valid thinking values for every offered level', async () => {
    const { buildAnthropicRequest } = await import('../convert.ts')
    const projected = buildCortexKitAnthropicModels(ANTHROPIC_SDK_MODELS)
    const adaptiveIds = new Set([
      'claude-fable-5',
      'claude-fable-5-1',
      'claude-mythos-5',
      'claude-mythos-5-1',
      'claude-opus-5',
      'claude-opus-5-5',
      'claude-sonnet-5',
      'claude-sonnet-5-5',
    ])
    const effortRank: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
      xhigh: 4,
      max: 5,
    }
    const budgetByLevel: Record<string, number> = {
      minimal: 1_024,
      low: 4_096,
      medium: 10_240,
      high: 20_480,
      xhigh: 32_000,
    }

    for (const model of projected) {
      const isAdaptive = adaptiveIds.has(model.id)
      const levels = getSupportedThinkingLevels(
        model as unknown as Parameters<typeof getSupportedThinkingLevels>[0],
      )
      if (isAdaptive) {
        expect(levels).not.toContain('off')
        expect(levels).not.toContain('minimal')
      } else {
        expect(levels).not.toContain('xhigh')
        expect(levels).not.toContain('max')
      }
      const distinctValues: number[] = []
      for (const level of levels) {
        const { body } = await buildAnthropicRequest(
          model.id,
          { messages: [], systemPrompt: '', tools: [] } as any,
          level === 'off' ? {} : ({ reasoning: level } as any),
          { enabled: false, mode: 'explicit' },
        )
        if (isAdaptive) {
          expect(body.thinking).toEqual({
            type: 'adaptive',
            display: 'summarized',
          })
          const effort = body.output_config?.effort
          expect(effort).toBeDefined()
          expect(['low', 'medium', 'high', 'xhigh', 'max']).toContain(effort!)
          expect(effort).not.toBe('minimal')
          distinctValues.push(effortRank[effort!]!)
        } else if (level === 'off') {
          expect(body.thinking).toBeUndefined()
          expect(body.output_config).toBeUndefined()
        } else {
          const budget = (
            body.thinking as { type: 'enabled'; budget_tokens: number }
          ).budget_tokens
          expect(body.thinking?.type).toBe('enabled')
          expect(Number.isInteger(budget) && budget > 0).toBe(true)
          expect(budget).toBe(budgetByLevel[level]!)
          distinctValues.push(budget)
        }
      }
      expect(new Set(distinctValues).size).toBe(distinctValues.length)
      for (let index = 1; index < distinctValues.length; index++) {
        expect(distinctValues[index]).toBeGreaterThan(
          distinctValues[index - 1]!,
        )
      }
    }
  })
})

// Oh My Pi 18.x dropped SessionManager.buildContextEntries(); calling it threw
// on every turn, so no effort history was ever collected (issue #200). Only
// getSessionId/getBranch are assumed here — the accessors both hosts expose.
describe('cortexKitPiAnthropicAuth turn_start effort history', () => {
  test('carries transitions from a getBranch-only host into the request', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-turn-start-effort-'))
    const storagePath = join(tempDir, 'anthropic-auth.json')
    process.env.PI_ANTHROPIC_AUTH_FILE = storagePath
    await saveAccounts(
      {
        version: 1,
        main: { type: 'opencode', provider: 'anthropic' },
        accounts: [],
      },
      storagePath,
    )

    const { pi, providers, events } = mockPi()
    await cortexKitPiAnthropicAuth(pi)

    // minimal -> low, then xhigh, with one assistant message between them.
    const branch = [
      { id: 't0', type: 'thinking_level_change', thinkingLevel: 'minimal' },
      { id: 'u1', type: 'message', message: { role: 'user' } },
      { id: 'a1', type: 'message', message: { role: 'assistant' } },
      { id: 't1', type: 'thinking_level_change', thinkingLevel: 'xhigh' },
      { id: 'u2', type: 'message', message: { role: 'user' } },
    ]
    const handler = events.get('turn_start')
    expect(handler).toBeDefined()
    await handler?.(
      { type: 'turn_start' },
      {
        sessionManager: {
          getSessionId: () => 'session-omp',
          getBranch: () => branch,
          getEntries: () => branch,
        },
      },
    )

    // Only the messages POST may be captured: if the stream path ever adds
    // another request (relay, quota, retry), this must fail loudly rather than
    // let the assertions below inspect that body instead.
    let requestBody: Record<string, unknown> | undefined
    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = input.toString()
        if (url.includes('/api/claude_cli/bootstrap')) {
          return new Response(
            JSON.stringify({
              oauth_account: { account_uuid: 'pi-turn-start-account' },
            }),
          )
        }
        const method = (init?.method ?? 'GET').toUpperCase()
        if (method !== 'POST' || !url.startsWith(messagesUrl)) {
          throw new Error(`unexpected request: ${method} ${url}`)
        }
        expect(requestBody).toBeUndefined()
        requestBody = JSON.parse(String(init?.body))
        return new Response(
          [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join(''),
          { status: 200 },
        )
      },
    ) as unknown as typeof fetch

    const stream = providers.get('anthropic')?.streamSimple?.(
      fableModel,
      {
        systemPrompt: 'test',
        tools: [],
        messages: [
          { role: 'user', content: 'first', timestamp: 0 },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'answer' }],
            timestamp: 0,
          },
          { role: 'user', content: 'second', timestamp: 0 },
        ],
      },
      { apiKey: 'sk-ant-oat-turn-start', sessionId: 'session-omp' },
    )
    for await (const _event of stream as AsyncIterable<unknown>) {
      // Drain the provider stream.
    }

    // The transitions the handler collected, as the request carries them: the
    // opening effort on the body and the later change as its own marker turn.
    expect(requestBody).toBeDefined()
    const sent = requestBody as { output_config: unknown; messages: unknown[] }
    expect(sent.output_config).toEqual({ effort: 'low' })
    expect(sent.messages[2]).toEqual({
      role: 'system',
      content: [],
      output_config: { effort: 'xhigh' },
    })
  })

  test('degrades to no transitions when the host session shape is unreadable', async () => {
    const { pi, events } = mockPi()
    await cortexKitPiAnthropicAuth(pi)

    const handler = events.get('turn_start')
    expect(handler).toBeDefined()
    const ctx = {
      sessionManager: {
        getSessionId: () => 'session-broken',
        getBranch: () => {
          throw new TypeError('getBranch is not a function')
        },
      },
    }

    expect(await handler?.({ type: 'turn_start' }, ctx)).toBeUndefined()
  })
})
