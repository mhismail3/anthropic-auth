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

type ConverterBranch = 'adaptive-summary' | 'generic-token-budget'

const CONVERTER_ALLOWLIST: Readonly<Record<string, ConverterBranch>> = {
  [CLAUDE_FABLE_5_MODEL_ID]: 'adaptive-summary',
  [CLAUDE_FABLE_5_1_MODEL_ID]: 'adaptive-summary',
  'claude-opus-5-5': 'adaptive-summary',
  'claude-opus-5': 'adaptive-summary',
  'claude-opus-4-8': 'generic-token-budget',
  'claude-opus-4-5': 'generic-token-budget',
  'claude-sonnet-4-5': 'generic-token-budget',
  'claude-sonnet-5': 'adaptive-summary',
  'claude-sonnet-5-5': 'adaptive-summary',
  'claude-mythos-5': 'adaptive-summary',
  'claude-mythos-5-1': 'adaptive-summary',
  // CAT-1 captures: these legacy-thinking models send the same enabled budget
  // shape through CortexKit and the pinned SDK's anthropic-messages provider.
  'claude-haiku-4-5': 'generic-token-budget',
  'claude-haiku-4-5-20251001': 'generic-token-budget',
  'claude-opus-4-5-20251101': 'generic-token-budget',
  'claude-sonnet-4-5-20250929': 'generic-token-budget',
  // Excluded: Opus 4.6/4.7 and Sonnet 4.6 are SDK adaptive-thinking models;
  // CortexKit's generic converter emits budget_tokens instead of adaptive effort.
}

function cloneModel<T extends AnthropicSdkModel>(model: T): T {
  return structuredClone(model)
}

function adaptModel(
  source: AnthropicSdkModel,
  branch: ConverterBranch,
): CortexKitAnthropicModel {
  const model = cloneModel(source)
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
): CortexKitAnthropicModel[] {
  const byId = new Map(sdkModels.map((model) => [model.id, model]))
  const models: CortexKitAnthropicModel[] = []

  for (const sdkModel of sdkModels) {
    const branch = CONVERTER_ALLOWLIST[sdkModel.id]
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

export function getCortexKitAnthropicModels() {
  return buildCortexKitAnthropicModels(ANTHROPIC_SDK_MODELS)
}
