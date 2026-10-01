import {
  CLAUDE_FABLE_5_1_MODEL_ID,
  CLAUDE_FABLE_5_MODEL_ID,
  CLAUDE_FABLE_MYTHOS_5_1_PRICING,
  CLAUDE_FABLE_MYTHOS_5_CONTEXT_WINDOW,
  CLAUDE_FABLE_MYTHOS_5_MAX_OUTPUT_TOKENS,
  CLAUDE_FABLE_MYTHOS_5_PRICING,
  CLAUDE_MYTHOS_5_1_MODEL_ID,
  CLAUDE_MYTHOS_5_MODEL_ID,
} from '@cortexkit/anthropic-auth-core'
import type { Model } from '@earendil-works/pi-ai'
// Pi's extension loader aliases only the pi-ai root, /compat, /oauth and
// /providers/all; other subpaths do not resolve inside an installed extension.
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

export type AnthropicSdkModel = Model<'anthropic-messages'>

// Capture the built-in catalog before any provider registration can replace it.
// Both normal and Claustrum registration consume projections of this one snapshot.
export const ANTHROPIC_SDK_MODELS: readonly AnthropicSdkModel[] =
  structuredClone(getBuiltinModels('anthropic')) as AnthropicSdkModel[]

export type CortexKitAnthropicModel = Omit<AnthropicSdkModel, 'api'> & {
  api: string
  baseUrl: string
}

export type ConverterBranch = 'adaptive-summary' | 'generic-token-budget'

const LEGACY_BUDGET_ALLOWLIST = new Set([
  'claude-opus-4-8',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  // CAT-1 captures: these legacy-thinking models send the same enabled budget
  // shape through CortexKit and the pinned SDK's anthropic-messages provider.
  'claude-haiku-4-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-5-20251101',
  'claude-sonnet-4-5-20250929',
])

const EXCLUDED_ADAPTIVE_IDS = new Set([
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  // Excluded: these IDs remain withheld until captured with this converter.
])

export function getConverterBranch(
  model: Pick<
    AnthropicSdkModel,
    'id' | 'api' | 'baseUrl' | 'reasoning' | 'compat'
  >,
): ConverterBranch | undefined {
  if (EXCLUDED_ADAPTIVE_IDS.has(model.id)) return undefined
  if (LEGACY_BUDGET_ALLOWLIST.has(model.id)) return 'generic-token-budget'
  if (
    model.api === 'anthropic-messages' &&
    model.baseUrl === 'https://api.anthropic.com' &&
    model.reasoning === true &&
    model.compat?.forceAdaptiveThinking === true
  )
    return 'adaptive-summary'
  return undefined
}

function isValidStoredModel(value: unknown): value is AnthropicSdkModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const model = value as Record<string, unknown>
  return (
    typeof model.id === 'string' &&
    model.id.length > 0 &&
    model.id.length <= 128 &&
    typeof model.name === 'string' &&
    model.name.length <= 256 &&
    model.api === 'anthropic-messages' &&
    model.baseUrl === 'https://api.anthropic.com' &&
    typeof model.reasoning === 'boolean' &&
    Array.isArray(model.input) &&
    model.input.length <= 8 &&
    model.input.every((item) => item === 'text' || item === 'image') &&
    !!model.cost &&
    typeof model.cost === 'object' &&
    ['input', 'output', 'cacheRead', 'cacheWrite'].every((key) => {
      const rate = (model.cost as Record<string, unknown>)[key]
      return typeof rate === 'number' && Number.isFinite(rate) && rate >= 0
    }) &&
    Number.isInteger(model.contextWindow) &&
    Number(model.contextWindow) > 0 &&
    Number.isInteger(model.maxTokens) &&
    Number(model.maxTokens) > 0 &&
    (!model.thinkingLevelMap ||
      (typeof model.thinkingLevelMap === 'object' &&
        !Array.isArray(model.thinkingLevelMap))) &&
    (!model.compat ||
      (typeof model.compat === 'object' && !Array.isArray(model.compat)))
  )
}

/** Merge the persisted provider snapshot. The generated-at bundle timestamp is
 * not exposed by the extension loader's pi-ai aliases, so stored overlay entries
 * are considered authoritative by ID; new remote models appear next refresh. */
export function mergeAnthropicCatalog(
  sdkModels: readonly AnthropicSdkModel[],
  stored: unknown,
): AnthropicSdkModel[] {
  const byId = new Map(sdkModels.map((model) => [model.id, cloneModel(model)]))
  try {
    const entry = stored as
      | { models?: unknown; lastModified?: unknown }
      | undefined
    if (!entry || !Array.isArray(entry.models) || entry.models.length > 1000)
      return [...byId.values()]
    for (const candidate of entry.models) {
      if (!isValidStoredModel(candidate)) continue
      byId.set(candidate.id, cloneModel(candidate))
    }
  } catch {
    return [...sdkModels].map(cloneModel)
  }
  return [...byId.values()]
}

function cloneModel<T extends AnthropicSdkModel>(model: T): T {
  return structuredClone(model)
}

function adaptModel(
  source: AnthropicSdkModel,
  branch: ConverterBranch,
): CortexKitAnthropicModel {
  const model = cloneModel(source)
  // SDK warming assumes options.cacheRetention controls the wire TTL. Here the
  // account-side claudeCache policy owns it, and CortexKit's explicit cacheKeep
  // owns warming. Advertising SDK lifetimes would enable a second scheduler
  // with the wrong TTL (and unsafe one-token replays on budget-thinking models).
  delete model.promptCache
  const thinkingLevelMap = { ...model.thinkingLevelMap }
  if (branch === 'adaptive-summary') {
    // The converter cannot disable adaptive thinking; minimal duplicates low.
    thinkingLevelMap.off = null
    thinkingLevelMap.minimal = null
  } else {
    // The budget converter has no distinct xhigh/max representation.
    thinkingLevelMap.xhigh = null
    thinkingLevelMap.max = null
  }
  return {
    ...model,
    thinkingLevelMap,
    api: 'cortexkit-anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
  } as CortexKitAnthropicModel
}

/** Pure catalog projection; never mutates SDK-owned model objects. */
export function buildCortexKitAnthropicModels(
  sdkModels: readonly AnthropicSdkModel[],
  stored?: unknown,
): CortexKitAnthropicModel[] {
  const catalog =
    stored === undefined
      ? sdkModels.map(cloneModel)
      : mergeAnthropicCatalog(sdkModels, stored)
  const byId = new Map(catalog.map((model) => [model.id, model]))
  const models: CortexKitAnthropicModel[] = []

  for (const sdkModel of catalog) {
    const branch = getConverterBranch(sdkModel)
    if (!branch) continue
    models.push(adaptModel(sdkModel, branch))
  }

  for (const [id, label, pricing] of [
    [
      CLAUDE_MYTHOS_5_MODEL_ID,
      'Claude Mythos 5',
      CLAUDE_FABLE_MYTHOS_5_PRICING,
    ],
    [
      CLAUDE_MYTHOS_5_1_MODEL_ID,
      'Claude Mythos 5.1',
      CLAUDE_FABLE_MYTHOS_5_1_PRICING,
    ],
  ] as const) {
    // Explicit CortexKit-only entry: remove once the pinned SDK lists it.
    if (byId.has(id)) continue
    const nearest = byId.get(
      id === CLAUDE_MYTHOS_5_MODEL_ID
        ? CLAUDE_FABLE_5_MODEL_ID
        : CLAUDE_FABLE_5_1_MODEL_ID,
    )
    if (!nearest) continue
    models.push(
      adaptModel(
        {
          ...cloneModel(nearest),
          id,
          name: label,
          cost: {
            input: pricing.input,
            output: pricing.output,
            cacheRead: pricing.cacheRead,
            cacheWrite: pricing.cacheWrite5m,
          },
          contextWindow: CLAUDE_FABLE_MYTHOS_5_CONTEXT_WINDOW,
          maxTokens: CLAUDE_FABLE_MYTHOS_5_MAX_OUTPUT_TOKENS,
        },
        'adaptive-summary',
      ),
    )
  }

  return models
}

export function getCortexKitAnthropicModels(stored?: unknown) {
  return buildCortexKitAnthropicModels(ANTHROPIC_SDK_MODELS, stored)
}
