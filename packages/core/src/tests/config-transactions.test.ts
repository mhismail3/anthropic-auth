import { afterEach, expect, spyOn, test } from 'bun:test'
import { existsSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createEmptyStorage,
  loadAccounts,
  mutateAccountsPersistent,
  saveAccounts,
  setCache1hPersistentEnabled,
  setCache1hPersistentMode,
  setCacheKeepPersistentAlways,
  setCacheKeepPersistentEnabled,
  setCacheKeepPersistentWindow,
  setCacheKeepSubagentsEnabled,
  setDumpPersistentEnabled,
  setFastModePersistentEnabled,
  setKillswitchPersistent,
  setLogLevelPersistent,
  setPrimePersistentEnabled,
} from '../accounts.ts'
import { setLogLevel } from '../logger.ts'
import { setRoutingMode } from '../routing.ts'

let directory: string | undefined
let readSpy: ReturnType<typeof spyOn> | undefined
afterEach(async () => {
  readSpy?.mockRestore()
  readSpy = undefined
  setLogLevel('info')
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
})
async function fixture() {
  directory = await fs.mkdtemp(join(tmpdir(), 'config-transaction-'))
  const path = join(directory, 'accounts.json')
  await saveAccounts(
    {
      ...createEmptyStorage(),
      mainAccountId: 'synthetic-identity',
      claudeCache: { enabled: false, mode: 'explicit' },
      cacheKeep: { enabled: false, subagents: true },
    },
    path,
  )
  return path
}

const setters: Array<[string, (path: string) => Promise<unknown>]> = [
  ['cache enable', (p) => setCache1hPersistentEnabled(true, undefined, p)],
  ['cache mode', (p) => setCache1hPersistentMode('automatic', p)],
  ['dump', (p) => setDumpPersistentEnabled(true, p)],
  ['fast', (p) => setFastModePersistentEnabled(true, p)],
  ['keep window', (p) => setCacheKeepPersistentWindow(9, 23, p)],
  ['keep always', (p) => setCacheKeepPersistentAlways(p)],
  ['keep enabled', (p) => setCacheKeepPersistentEnabled(true, p)],
  ['keep subagents', (p) => setCacheKeepSubagentsEnabled(false, p)],
  ['prime', (p) => setPrimePersistentEnabled(true, p)],
  ['logging', (p) => setLogLevelPersistent('debug', p)],
  ['killswitch', (p) => setKillswitchPersistent({ enabled: true }, p)],
  ['routing', (p) => setRoutingMode('fallback-first', p)],
]

test.each(setters)(
  '%s reads configuration under the existing transaction lock',
  async (_name, change) => {
    const path = await fixture()
    const originalRead = fs.readFile
    const unlockedReads: string[] = []
    // Observe the real I/O boundary without delaying it. This negative control
    // catches stale-snapshot setters deterministically, even if two writes happen
    // to serialize favorably in a particular concurrent test run.
    readSpy = spyOn(fs, 'readFile').mockImplementation((...args: any[]) => {
      if (String(args[0]) === path && !existsSync(`${path}.config-write.lock`))
        unlockedReads.push(path)
      return (originalRead as any)(...args)
    })
    await change(path)
    readSpy.mockRestore()
    readSpy = undefined
    expect(unlockedReads).toEqual([])
    expect(await loadAccounts(path)).toMatchObject({
      mainAccountId: 'synthetic-identity',
      accounts: [],
    })
  },
)

test('independent processes preserve cache mode, enablement and unrelated configuration', async () => {
  const path = await fixture()
  const module = new URL('../accounts.ts', import.meta.url).href
  const statements = [
    `await a.setCache1hPersistentEnabled(true, undefined, ${JSON.stringify(path)})`,
    `await a.setCache1hPersistentMode('automatic', ${JSON.stringify(path)})`,
    `await a.setDumpPersistentEnabled(true, ${JSON.stringify(path)})`,
  ]
  const children = statements.map((statement) =>
    Bun.spawn(
      [
        process.execPath,
        '-e',
        `import * as a from ${JSON.stringify(module)}; ${statement}`,
      ],
      {
        env: { ...process.env, NODE_ENV: 'test' },
        stdout: 'ignore',
        stderr: 'inherit',
      },
    ),
  )
  const statuses = await Promise.all(children.map((child) => child.exited))
  expect(statuses).toEqual([0, 0, 0])
  expect(await loadAccounts(path)).toMatchObject({
    claudeCache: { enabled: true, mode: 'automatic' },
    dump: { enabled: true },
  })
})

test('initial storage policy is applied only when the locked store is absent', async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'config-initial-'))
  const path = join(directory, 'accounts.json')
  let initialized = 0
  const options = {
    initialStorage: () => {
      initialized++
      return {
        ...createEmptyStorage(),
        quota: { minimumRemaining: { five_hour: 10, seven_day: 20 } },
      }
    },
  }
  await mutateAccountsPersistent(
    path,
    (storage) => ({ storage, result: undefined }),
    options,
  )
  await setCache1hPersistentEnabled(true, undefined, path)
  await mutateAccountsPersistent(
    path,
    (storage) => ({ storage, result: undefined }),
    options,
  )
  expect(initialized).toBe(1)
  expect(await loadAccounts(path)).toMatchObject({
    claudeCache: { enabled: true },
    quota: { minimumRemaining: { five_hour: 10, seven_day: 20 } },
  })
})

test('concurrent cache enable, mode, and unrelated settings all survive', async () => {
  const path = await fixture()
  await Promise.all([
    setCache1hPersistentEnabled(true, undefined, path),
    setCache1hPersistentMode('automatic', path),
    setDumpPersistentEnabled(true, path),
    setFastModePersistentEnabled(true, path),
    setRoutingMode('fallback-first', path),
    setCacheKeepPersistentAlways(path),
  ])
  expect(await loadAccounts(path)).toMatchObject({
    mainAccountId: 'synthetic-identity',
    accounts: [],
    claudeCache: { enabled: true, mode: 'automatic' },
    dump: { enabled: true },
    claudeFast: { enabled: true },
    routing: { mode: 'fallback-first' },
    cacheKeep: { enabled: true, always: true, subagents: true },
  })
})
