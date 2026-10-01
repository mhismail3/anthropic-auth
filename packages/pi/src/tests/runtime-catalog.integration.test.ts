/*
Failure modes targeted by these real ModelRuntime integration tests:
- legacy ProviderConfig refresh fails to receive and expose a fresh persisted adaptive catalog;
- stale persisted overlays replace bundled models even though Pi rejects them;
- malformed model-store entries prevent provider registration or bundled projection;
- refresh writes CortexKit's transformed projection back into Pi's source store;
- Claustrum's native provider bypasses the stored snapshot or persists its projection.
*/
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getSupportedThinkingLevels,
  normalizeContext,
} from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  ProviderConfig,
} from '@earendil-works/pi-coding-agent'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import cortexKitPiAnthropicAuth from '../index.ts'
import { ANTHROPIC_SDK_MODELS } from '../model-catalog.ts'

const originalFetch = globalThis.fetch
const originalAgentDir = process.env.PI_CODING_AGENT_DIR
const originalAccountFile = process.env.PI_ANTHROPIC_AUTH_FILE
const originalOffline = process.env.PI_OFFLINE
const temporaryDirectories: string[] = []

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir
  if (originalAccountFile === undefined)
    delete process.env.PI_ANTHROPIC_AUTH_FILE
  else process.env.PI_ANTHROPIC_AUTH_FILE = originalAccountFile
  if (originalOffline === undefined) delete process.env.PI_OFFLINE
  else process.env.PI_OFFLINE = originalOffline
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-runtime-catalog-'))
  temporaryDirectories.push(dir)
  const agentDir = join(dir, 'agent')
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(agentDir, { recursive: true }),
  )
  const modelsStorePath = join(agentDir, 'models-store.json')
  return { dir, agentDir, modelsStorePath }
}

// Sonnet 6.5's models-store metadata under an ID the bundled SDK does not list,
// so these tests prove restoration of a store-only model.
const sonnet55 = {
  id: 'claude-sonnet-6-5',
  name: 'Claude Sonnet 6.5',
  api: 'anthropic-messages',
  provider: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  contextWindow: 1000000,
  maxTokens: 128000,
  thinkingLevelMap: {
    off: null,
    minimal: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  compat: {
    supportsMidConvoEffort: true,
    supportsMidConvoSystemMessages: true,
    supportsMidConvoToolChanges: true,
    forceAdaptiveThinking: true,
    supportsTemperature: false,
    supportsStrictTools: true,
  },
  promptCache: { short: 300, long: 3600 },
  inputLimits: {
    maxRequestBytes: 33554432,
    images: {
      maxPerRequest: 600,
      resize: {
        maxWidth: 2000,
        maxHeight: 2000,
        maxBytes: 4718592,
        jpegQuality: 80,
      },
    },
  },
  type: 'chat',
}

function makePi(runtime: ModelRuntime) {
  const pi = {
    on() {},
    registerCommand() {},
    registerProvider(value: ProviderConfig | string, config?: ProviderConfig) {
      if (typeof value === 'string') runtime.registerProvider(value, config!)
      else runtime.registerNativeProvider(value as never)
    },
  }
  return pi as unknown as ExtensionAPI
}

async function createRuntime(storePath: string, credentials?: unknown) {
  return ModelRuntime.create({
    modelsPath: join(storePath, '..', 'models.json'),
    modelsStorePath: storePath,
    refreshOnCreate: false,
    allowModelNetwork: false,
    credentials: credentials as never,
  })
}

test('legacy provider runtime restores the fresh store, dispatches adaptive thinking, and makes no catalog fetch', async () => {
  const { agentDir, modelsStorePath } = await fixture()
  process.env.PI_CODING_AGENT_DIR = agentDir
  process.env.PI_OFFLINE = '1'
  const template = ANTHROPIC_SDK_MODELS.find(
    (model) => model.id === 'claude-fable-5',
  )!
  const adaptive = {
    ...structuredClone(template),
    id: 'claude-sonnet-9',
    name: 'Claude Sonnet 9',
  }
  const unknown = {
    ...structuredClone(template),
    id: 'claude-unknown-1',
    name: 'Unknown',
    reasoning: false,
    compat: {},
  }
  const opus46 = ANTHROPIC_SDK_MODELS.find(
    (model) => model.id === 'claude-opus-4-6',
  )!
  const stored = {
    models: [sonnet55, adaptive, unknown, opus46],
    checkedAt: 1,
    lastModified: Number.MAX_SAFE_INTEGER,
  }
  await writeFile(modelsStorePath, JSON.stringify({ anthropic: stored }))
  let fetchCalls = 0
  const requestBodies: Record<string, any>[] = []
  globalThis.fetch = (async (input, init) => {
    fetchCalls++
    if (String(input).includes('/v1/messages')) {
      requestBodies.push(JSON.parse(String(init?.body)))
      return new Response(
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":0}}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    }
    throw new Error(`Unexpected catalog fetch: ${String(input)}`)
  }) as typeof fetch
  const credentials = {
    read: async () => ({
      type: 'oauth',
      access: 'test-access',
      refresh: 'test-refresh',
      expires: Date.now() + 60_000,
    }),
    list: async () => [{ providerId: 'anthropic', type: 'oauth' as const }],
    modify: async () => undefined,
    delete: async () => undefined,
  }
  const runtime = await createRuntime(modelsStorePath, credentials)
  await cortexKitPiAnthropicAuth(makePi(runtime))
  // Registration must already contain persisted entries: ModelRuntime rebuilds
  // providers synchronously and can otherwise drop refreshed closure state.
  expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')).toBeDefined()
  expect(runtime.getModel('anthropic', 'claude-sonnet-9')).toBeDefined()
  await runtime.refresh({ allowNetwork: false })
  expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')).toBeDefined()
  const firstRefresh = runtime.refresh({ allowNetwork: false })
  const secondRefresh = runtime.refresh({ allowNetwork: false })
  expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')).toBeDefined()
  await Promise.all([firstRefresh, secondRefresh])
  expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')).toBeDefined()
  for (const id of ['claude-sonnet-6-5', 'claude-sonnet-9']) {
    const model = runtime.getModel('anthropic', id)
    expect(model).toBeDefined()
    expect(model?.api).toBe('cortexkit-anthropic-messages')
    expect(getSupportedThinkingLevels(model as never)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ])
  }
  expect(runtime.getModel('anthropic', 'claude-unknown-1')).toBeUndefined()
  expect(runtime.getModel('anthropic', 'claude-opus-4-6')).toBeUndefined()
  await runtime.setRuntimeApiKey('anthropic', 'test-access')
  const sonnet = runtime.getModel('anthropic', 'claude-sonnet-6-5')!
  const streamEvents: unknown[] = []
  for await (const event of runtime.streamSimple(
    sonnet,
    normalizeContext({
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
      systemPrompt: '',
      tools: [],
    }),
    { reasoning: 'xhigh' } as never,
  ))
    streamEvents.push(event)
  expect(streamEvents.filter((event: any) => event.type === 'error')).toEqual(
    [],
  )
  expect(requestBodies[0]?.thinking).toEqual({
    type: 'adaptive',
    display: 'summarized',
  })
  expect(requestBodies[0]?.output_config).toEqual({ effort: 'xhigh' })
  expect(requestBodies[0]?.thinking?.budget_tokens).toBeUndefined()
  const opus48 = runtime.getModel('anthropic', 'claude-opus-4-8')!
  for await (const _event of runtime.streamSimple(
    opus48,
    normalizeContext({
      messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }],
      systemPrompt: '',
      tools: [],
    }),
    { reasoning: 'high' } as never,
  )) {
  }
  expect(requestBodies[1]?.thinking).toEqual({
    type: 'enabled',
    budget_tokens: 20_480,
  })
  expect(requestBodies[1]?.output_config).toBeUndefined()
  expect(fetchCalls).toBe(2)
})

describe('runtime catalog overlay edge cases', () => {
  test('stale overlay retains bundled catalog unchanged', async () => {
    const { agentDir, modelsStorePath } = await fixture()
    process.env.PI_CODING_AGENT_DIR = agentDir
    const bundled = ANTHROPIC_SDK_MODELS.find(
      (model) => model.id === 'claude-opus-4-8',
    )!
    await writeFile(
      modelsStorePath,
      JSON.stringify({
        anthropic: {
          lastModified: 1,
          models: [{ ...sonnet55, id: bundled.id, name: 'stale' }],
        },
      }),
    )
    const runtime = await createRuntime(modelsStorePath)
    await cortexKitPiAnthropicAuth(makePi(runtime))
    await runtime.refresh({ allowNetwork: false })
    expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')).toBeUndefined()
    expect(runtime.getModel('anthropic', bundled.id)?.name).toBe(bundled.name)
  })

  test('malformed overlay still registers and exposes the bundled projection', async () => {
    const { agentDir, modelsStorePath } = await fixture()
    process.env.PI_CODING_AGENT_DIR = agentDir
    await writeFile(
      modelsStorePath,
      JSON.stringify({
        anthropic: { lastModified: Number.MAX_SAFE_INTEGER, models: 'x' },
      }),
    )
    const runtime = await createRuntime(modelsStorePath)
    await expect(
      cortexKitPiAnthropicAuth(makePi(runtime)),
    ).resolves.toBeUndefined()
    expect(runtime.getModel('anthropic', 'claude-opus-4-8')).toBeDefined()
    await runtime.refresh({ allowNetwork: false })
    expect(runtime.getModel('anthropic', 'claude-opus-4-8')).toBeDefined()
  })

  test('refresh never persists the CortexKit projection into the model store', async () => {
    const { agentDir, modelsStorePath } = await fixture()
    process.env.PI_CODING_AGENT_DIR = agentDir
    const bytes = JSON.stringify(
      {
        anthropic: {
          lastModified: Number.MAX_SAFE_INTEGER,
          models: [sonnet55],
        },
      },
      null,
      2,
    )
    await writeFile(modelsStorePath, bytes)
    const runtime = await createRuntime(modelsStorePath)
    await cortexKitPiAnthropicAuth(makePi(runtime))
    await runtime.refresh({ allowNetwork: false })
    expect(await readFile(modelsStorePath, 'utf8')).toBe(bytes)
    expect(await readFile(modelsStorePath, 'utf8')).not.toContain(
      'cortexkit-anthropic-messages',
    )
  })

  test('Claustrum native provider restores Sonnet 6.5 without persisting projection', async () => {
    const { agentDir, modelsStorePath } = await fixture()
    process.env.PI_CODING_AGENT_DIR = agentDir
    process.env.PI_ANTHROPIC_AUTH_FILE = join(agentDir, 'accounts.json')
    const bytes = JSON.stringify(
      {
        anthropic: {
          lastModified: Number.MAX_SAFE_INTEGER,
          models: [sonnet55],
        },
      },
      null,
      2,
    )
    await writeFile(modelsStorePath, bytes)
    await writeFile(
      process.env.PI_ANTHROPIC_AUTH_FILE,
      JSON.stringify({ claustrum: { mode: 'claustrum' } }),
    )
    const runtime = await createRuntime(modelsStorePath)
    await cortexKitPiAnthropicAuth(makePi(runtime), {
      connectScoped: async () => ({}) as never,
      pollIntervalMs: 0,
    })
    expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')).toBeDefined()
    await runtime.refresh({ allowNetwork: false })
    expect(runtime.getModel('anthropic', 'claude-sonnet-6-5')?.api).toBe(
      'cortexkit-anthropic-messages',
    )
    expect(await readFile(modelsStorePath, 'utf8')).toBe(bytes)
  })
})
