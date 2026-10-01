import {
  type AccountStorage,
  type Cache1hMode,
  getCache1hPersistentMode,
  mutateAccountsPersistent,
} from '@cortexkit/anthropic-auth-core'

/** The Pi/Tron integration defaults to 1h without rewriting an existing user's
 * choice. OpenCode's shared-core defaults remain independent. */
export function getPiCachePolicy(storage: AccountStorage | null) {
  const enabled = storage?.claudeCache?.enabled
  return {
    enabled: enabled === undefined || enabled === true,
    mode: getCache1hPersistentMode(storage),
  }
}

export function setPiCacheMode(mode: Cache1hMode, path: string) {
  return mutateAccountsPersistent(path, (storage) => {
    storage.claudeCache = {
      ...storage.claudeCache,
      ...getPiCachePolicy(storage),
      mode,
    }
    return { storage, result: storage }
  })
}
