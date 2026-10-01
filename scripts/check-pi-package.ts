// Offline adoption gate: test the packed artifacts, not source imports or an installed profile.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { Api, Message, Model } from '@earendil-works/pi-ai'
import type { ProviderConfig } from '@earendil-works/pi-coding-agent'

const [coreArchive, piArchive] = process.argv.slice(2)
assert(
  coreArchive && piArchive,
  'Usage: node scripts/check-pi-package.ts <core.tgz> <pi.tgz>',
)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(join(tmpdir(), 'cortexkit-packed-pi-'))
const originalFetch = globalThis.fetch
const savedEnvironment = { ...process.env }
try {
  const profile = join(temporary, 'profile')
  const accounts = join(profile, 'anthropic-auth.json')
  await mkdir(profile, { recursive: true })
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PI_CODING_AGENT_DIR: profile,
    PI_AGENT_DIR: profile,
    PI_ANTHROPIC_AUTH_FILE: accounts,
    PI_ANTHROPIC_AUTH_ROUTING_STATE_FILE: join(profile, 'routing.json'),
    PI_ANTHROPIC_AUTH_CACHEKEEP_REGISTRY_DIR: join(profile, 'cachekeep'),
    PI_ANTHROPIC_AUTH_CLAUSTRUM_ENROLLMENT_FILE: join(
      profile,
      'enrollment.json',
    ),
    OPENCODE_CONFIG_DIR: profile,
    OPENCODE_ANTHROPIC_AUTH_FILE: accounts,
    OPENCODE_ANTHROPIC_AUTH_STATE_FILE: join(profile, 'state.json'),
    OPENCODE_ANTHROPIC_AUTH_LOG_FILE: join(profile, 'log'),
  })
  globalThis.fetch = (async () => {
    throw new Error('Unexpected network access during package loading')
  }) as unknown as typeof fetch
  const modules = join(temporary, 'node_modules')
  const core = join(modules, '@cortexkit', 'anthropic-auth-core')
  const pi = join(modules, '@cortexkit', 'pi-anthropic-auth')
  for (const [archive, destination] of [
    [coreArchive, core],
    [piArchive, pi],
  ] as const) {
    await mkdir(destination, { recursive: true })
    execFileSync('tar', [
      '-xzf',
      resolve(archive),
      '--strip-components=1',
      '-C',
      destination,
    ])
  }
  const coreManifest = JSON.parse(
    await readFile(join(core, 'package.json'), 'utf8'),
  )
  const piManifest = JSON.parse(
    await readFile(join(pi, 'package.json'), 'utf8'),
  )
  assert.equal(piManifest.dependencies[coreManifest.name], coreManifest.version)
  // Only external runtime dependencies are shared with the checkout. The code
  // under test must resolve to the extracted core, and Pi peers use loader aliases.
  for (const name of Object.keys(coreManifest.dependencies)) {
    const destination = join(modules, name)
    await mkdir(dirname(destination), { recursive: true })
    await symlink(join(root, 'node_modules', name), destination, 'dir')
  }
  const entry = join(pi, 'dist', 'index.js')
  // Resolve with Node from the extracted package, not Bun's workspace redirects.
  const probe = join(pi, 'resolve-core.mjs')
  await writeFile(
    probe,
    "export const coreUrl = import.meta.resolve('@cortexkit/anthropic-auth-core')\n",
  )
  const { coreUrl } = await import(pathToFileURL(probe).href)
  assert(fileURLToPath(coreUrl).startsWith(`${await realpath(core)}/`))
  const sdk = resolve(
    dirname(
      fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')),
    ),
    '..',
  )
  const { loadExtensions, createExtensionRuntime } = await import(
    pathToFileURL(join(sdk, 'dist/core/extensions/loader.js')).href
  )
  const { normalizeContext } = await import('@earendil-works/pi-ai')
  const runtime = createExtensionRuntime()
  const loaded = await loadExtensions([entry], temporary, undefined, runtime)
  assert.deepEqual(loaded.errors, [])
  assert.equal(loaded.extensions.length, 1)
  const configuration = runtime.pendingProviderRegistrations.find(
    (r: { name: string }) => r.name === 'anthropic',
  )?.config as ProviderConfig | undefined
  assert(
    configuration?.streamSimple,
    'Packed extension did not register the Anthropic stream',
  )
  assert(
    configuration.refreshModels,
    'Packed extension has no catalog refresh hook',
  )
  const bundleModel = configuration.models?.find(
    (m) => m.id === 'claude-fable-5',
  )
  assert(bundleModel)
  const futureModel = {
    ...bundleModel,
    id: 'claude-sonnet-9',
    name: 'Claude Sonnet 9',
    api: 'anthropic-messages',
    compat: {
      // Pi types compat only on its chat-model config variant.
      ...(bundleModel as { compat?: Record<string, unknown> }).compat,
      forceAdaptiveThinking: true,
    },
  }
  const projected = await configuration.refreshModels({
    stored: { models: [futureModel], checkedAt: Date.now() },
    signal: new AbortController().signal,
    allowNetwork: false,
    publish: async () => true,
  } as never)
  assert(
    projected.some((m) => m.id === 'claude-sonnet-9'),
    'Packed catalog omitted the stored future model',
  )
  const model = configuration.models?.find((m) => m.id === 'claude-opus-5-5')
  assert(model)
  // Pi types promptCache only on its chat-model config variant.
  assert.equal(
    (model as { promptCache?: unknown }).promptCache,
    undefined,
    'SDK must not independently warm CortexKit caches',
  )
  const command = loaded.extensions[0].commands.get('claude-cache')
  const notifications: string[] = []
  const context = { ui: { notify: (text: string) => notifications.push(text) } }
  // Merely inspect status: the first request must use 1h without setup commands.
  await command.handler('', context)
  const status = notifications.at(-1)
  assert(status)
  assert.match(status, /Enabled: enabled/)
  assert.match(status, /including subagents/)
  let calls = 0
  globalThis.fetch = (async (input, init) => {
    calls++
    assert.equal(new URL(String(input)).pathname, '/v1/messages')
    const body = JSON.parse(String(init?.body))
    assert.deepEqual(body.messages.at(-1).content.at(-1).cache_control, {
      type: 'ephemeral',
      ttl: '1h',
    })
    const events = [
      {
        type: 'message_start',
        message: {
          usage: {
            input_tokens: 2,
            cache_creation_input_tokens: 300,
            cache_creation: {
              ephemeral_5m_input_tokens: 100,
              ephemeral_1h_input_tokens: 200,
            },
          },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 7 },
      },
      { type: 'message_stop' },
    ]
    return new Response(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    )
  }) as typeof fetch
  const result = await configuration
    .streamSimple(
      { ...model, provider: 'anthropic' } as Model<Api>,
      normalizeContext({
        systemPrompt:
          'Stable instructions.\n\nPi documentation: synthetic documentation.',
        tools: [],
        messages: [
          { role: 'user', content: 'First', timestamp: 0 },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Answer' }],
            timestamp: 0,
          } as Message,
          { role: 'user', content: 'Follow-up', timestamp: 0 },
        ],
      }),
      { apiKey: 'synthetic-token', reasoning: 'medium' },
    )
    .result()
  assert.equal(result.stopReason, 'stop', result.errorMessage)
  assert.equal(calls, 1)
  assert(Math.abs(result.usage.cost.cacheWrite - 0.0021) < 1e-12)
  console.log(
    JSON.stringify({
      core: coreManifest.version,
      pi: piManifest.version,
      loader: 'passed',
      storedOverlay: 'claude-sonnet-9 exposed offline',
      wireCache: '1h explicit (no setup commands)',
      mixedTtlAccounting: 'passed',
      liveRequests: 0,
    }),
  )
} finally {
  globalThis.fetch = originalFetch
  for (const key of Object.keys(process.env))
    if (!(key in savedEnvironment)) delete process.env[key]
  Object.assign(process.env, savedEnvironment)
  await rm(temporary, { recursive: true, force: true })
}
