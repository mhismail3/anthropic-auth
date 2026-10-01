import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// An installed extension resolves Pi packages only through the extension
// loader's alias table, not through its own node_modules. A specifier outside
// that table loads in unit tests but fails when Pi loads the package.
function loaderAliases(): Set<string> {
  const require = createRequire(import.meta.url)
  const packageRoot = dirname(
    require.resolve('@earendil-works/pi-coding-agent/package.json'),
  )
  const loader = readFileSync(
    join(packageRoot, 'dist/core/extensions/loader.js'),
    'utf8',
  )
  return new Set(
    [...loader.matchAll(/"(@earendil-works\/[^"]+)":/g)].map(
      (match) => match[1] as string,
    ),
  )
}

function sourceSpecifiers(): string[] {
  const directory = join(import.meta.dir, '..')
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    .flatMap((name) => [
      ...readFileSync(join(directory, name), 'utf8').matchAll(
        /from '(@earendil-works\/[^']+)'/g,
      ),
    ])
    .map((match) => match[1] as string)
}

describe('Pi extension loader imports', () => {
  test('every Pi package imported by the extension is aliased by the loader', () => {
    const aliases = loaderAliases()
    expect(aliases.size).toBeGreaterThan(0)
    const unresolved = sourceSpecifiers().filter(
      (specifier) => !aliases.has(specifier),
    )
    expect(unresolved).toEqual([])
  })
})
