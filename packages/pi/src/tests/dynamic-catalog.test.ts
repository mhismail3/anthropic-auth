/*
Concrete failure modes covered here:
- bundled adaptive entries disappear when an unknown-ID exact allowlist is used;
- hostile, oversized, or malformed persisted entries crash catalog registration;
- projections mutate SDK/store model metadata or admit excluded/non-adaptive IDs;
- dynamic adaptive requests regress to budget_tokens or expose disabled thinking;
- an overlay entry replacing a bundle ID fails to win consistently.
*/
import { describe, expect, test } from 'bun:test'
import { normalizeContext } from '@earendil-works/pi-ai'
import { getBuiltinModelDataGeneratedAt } from '@earendil-works/pi-ai/providers/all'
import { buildAnthropicRequest } from '../convert.ts'
import {
  ANTHROPIC_SDK_MODELS,
  buildCortexKitAnthropicModels,
  mergeAnthropicCatalog,
} from '../model-catalog.ts'

describe('dynamic Anthropic catalog projection', () => {
  const template = ANTHROPIC_SDK_MODELS.find(
    (model) => model.id === 'claude-fable-5',
  )!
  const dynamicModel = (id: string, compat: Record<string, unknown> = {}) => ({
    ...structuredClone(template),
    id,
    name: id,
    api: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com',
    reasoning: true,
    compat: { ...template.compat, forceAdaptiveThinking: true, ...compat },
  })

  test('projects unknown future adaptive models and omits unproven or non-adaptive overlay entries', async () => {
    const future = dynamicModel('claude-sonnet-9')
    const unproven = { ...dynamicModel('claude-sonnet-10'), compat: {} }
    const noMetadata = {
      ...dynamicModel('claude-future-1'),
      baseUrl: 'https://proxy.invalid',
    }
    const excluded = dynamicModel('claude-opus-4-6')
    const datedExcluded = dynamicModel('claude-opus-4-7-20260101')
    const storedModels = [future, unproven, noMetadata, excluded, datedExcluded]
    const before = JSON.stringify(storedModels)
    const projected = buildCortexKitAnthropicModels(ANTHROPIC_SDK_MODELS, {
      lastModified: Number.MAX_SAFE_INTEGER,
      models: storedModels,
    })
    expect(projected.map((model) => model.id)).toContain('claude-sonnet-9')
    expect(projected.map((model) => model.id)).not.toContain('claude-sonnet-10')
    expect(projected.map((model) => model.id)).not.toContain('claude-future-1')
    expect(projected.map((model) => model.id)).not.toContain('claude-opus-4-6')
    expect(projected.map((model) => model.id)).not.toContain(
      'claude-opus-4-7-20260101',
    )
    expect(JSON.stringify(storedModels)).toBe(before)

    const requestModel = projected.find((model) => model.id === future.id)!
    for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const { body } = await buildAnthropicRequest(
        future.id,
        normalizeContext({ messages: [], systemPrompt: '', tools: [] }),
        { reasoning: level },
        { enabled: false, mode: 'explicit' },
        false,
        undefined,
        {},
        requestModel as unknown as typeof future,
      )
      expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' })
      expect(body.output_config).toEqual({ effort: level })
      expect(JSON.stringify(body)).not.toContain('budget_tokens')
      expect(JSON.stringify(body)).not.toContain('disabled')
    }
  })

  test('stored overlay replaces bundled entries without mutating either source', () => {
    const source = structuredClone(ANTHROPIC_SDK_MODELS)
    const replaced = {
      ...dynamicModel('claude-sonnet-5'),
      name: 'Overlay name',
    }
    const catalog = mergeAnthropicCatalog(source, {
      lastModified: Number.MAX_SAFE_INTEGER,
      models: [replaced],
    })
    expect(catalog.find((model) => model.id === replaced.id)?.name).toBe(
      'Overlay name',
    )
    expect(source.find((model) => model.id === replaced.id)?.name).not.toBe(
      'Overlay name',
    )
    expect(
      buildCortexKitAnthropicModels(source, { models: [{ id: 'evil' }] }),
    ).toEqual(buildCortexKitAnthropicModels(source))
  })

  test('ignores stale snapshots, non-array stores, and oversized stores', () => {
    const source = structuredClone(ANTHROPIC_SDK_MODELS)
    const bundled = source.find((model) => model.id === 'claude-opus-4-8')!
    const replaced = { ...dynamicModel(bundled.id), name: 'stale name' }
    const stale = mergeAnthropicCatalog(source, {
      lastModified: getBuiltinModelDataGeneratedAt(),
      models: [replaced],
    })
    expect(stale.find((model) => model.id === bundled.id)?.name).toBe(
      bundled.name,
    )
    expect(mergeAnthropicCatalog(source, { models: 'malformed' })).toEqual([
      ...source,
    ])
    expect(
      mergeAnthropicCatalog(source, {
        lastModified: Number.MAX_SAFE_INTEGER,
        models: Array.from({ length: 1001 }, () =>
          dynamicModel('claude-sonnet-99'),
        ),
      }),
    ).toEqual([...source])
  })
})
