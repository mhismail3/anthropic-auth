# @cortexkit/anthropic-auth-core

Shared Anthropic OAuth, stable account identity, optional Claustrum fallback-custody primitives, model metadata, quota, host-local quota feed, routing, cache, cache-keepalive, fast mode, relay, dump, request-signing, thinking-binding, and Fable 5.1 mid-conversation effort helpers used by CortexKit's OpenCode and Pi integrations.

## Configuration transactions

Configuration changes read and mutate under `mutateAccountsPersistent`'s existing config-write lease, with the config → state lock order preserved across processes. Serializing `saveAccounts` calls alone is insufficient: a snapshot loaded before the lease can overwrite unrelated settings. Cache, warming, fast-mode, dump, prime, logging, killswitch and routing setters use the transaction, as does relay setup after its network provisioning completes. Relay's initial policy is selected inside the lease only when no store exists. Do not perform network operations or nest persistence calls in a mutation callback; apply process-local effects and acknowledge success only after persistence succeeds.

`src/tests/config-transactions.test.ts` checks lock coverage at real file reads, concurrent field preservation, independent processes and one-time initialization. Account/credential roster and state tests remain separate protections. `saveAccounts` remains a whole-snapshot persistence API, not a safe read–modify–write settings operation.

User-facing packages:

- `@cortexkit/opencode-anthropic-auth` for OpenCode
- `@cortexkit/pi-anthropic-auth` for Pi
