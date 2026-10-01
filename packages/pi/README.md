# @cortexkit/pi-anthropic-auth

Pi package for CortexKit Anthropic OAuth support. It overrides Pi's built-in `anthropic` provider with the display name `Anthropic (CortexKit)` and a CortexKit provider extension backed by the shared `@cortexkit/anthropic-auth-core` package.

The provider maps Anthropic's Claude Code tool-name aliases back only through the exact tool-name snapshot sent in that request. Ambiguous aliases fail before dispatch; unknown response names remain unknown rather than being case-folded onto an executable host tool.

The Pi provider catalog is derived from the pinned Pi SDK's Anthropic catalog. CortexKit clones those entries, preserves their metadata and adapts only API identity and first-party base URL. It admits the current Fable 5/5.1, Opus 5/5.5/4.8/4.5, and Sonnet 5/5.5/4.5 entries, plus Haiku 4.5 and dated Haiku 4.5, Opus 4.5, and Sonnet 4.5 entries whose legacy thinking request shapes pass local captures. Opus 4.6/4.7 and Sonnet 4.6 remain unavailable in this Pi catalog because CortexKit's converter emits token-budget thinking while those SDK entries use adaptive effort. Mythos 5 and 5.1 remain explicit CortexKit additions until the pinned SDK lists them; their pricing and labels are CortexKit-owned. SDK catalog changes do not automatically imply subscription entitlement.

Fable/Mythos 5, Sonnet 5, Sonnet 5.5, Opus 5, and Opus 5.5 use adaptive-thinking/effort handling. The always-on adaptive branches hide `off`; `minimal` is hidden because the converter maps it to the same Anthropic `low` effort. Opus 5.5 and Sonnet 5.5 expose `low`, `medium`, `high`, `xhigh`, and `max`; their unsupported `off`/`minimal` levels remain hidden. Sonnet 5.5 also supports a `between_tools` mode for applications that explicitly turn off up-front thinking, but Pi's simple-provider options cannot request it. Budget-thinking models expose distinct `minimal`, `low`, `medium`, and `high` budgets plus `off`; Opus 4.8's SDK `xhigh`/`max` entries are hidden because this converter branch cannot represent them distinctly. OAuth Fable 5.1 sessions preserve Pi thinking-level changes as mid-conversation effort markers, so switching effort does not rewrite the cached prefix. When a later OAuth request replays Fable 5.1, Opus 5.5, or Sonnet 5.5 thinking after earlier messages, instructions, or tools have changed, `thinkingBinding.prefixMismatchBehavior` selects account behavior (`account-default`), rejection (`error`), or removal of mismatched thinking (`drop_block`). These controls require adaptive thinking.

This package is part of the CortexKit Anthropic Auth monorepo, which supports both OpenCode (`@cortexkit/opencode-anthropic-auth`) and Pi (`@cortexkit/pi-anthropic-auth`) through the same shared core logic.

## Setup wizard (recommended)

Use the unified setup wizard to install the extension and optionally configure Claustrum custody:

```bash
bunx @cortexkit/opencode-anthropic-auth setup
```

---

## Install

Install with Pi's package manager:

```bash
pi install npm:@cortexkit/pi-anthropic-auth@2.0.0
```

For an unpinned install:

```bash
pi install npm:@cortexkit/pi-anthropic-auth
```

To try it for one run without changing Pi settings:

```bash
pi -e npm:@cortexkit/pi-anthropic-auth
```

Restart Pi after installing, then authenticate through Pi's normal login flow:

```text
/login anthropic
```

## Sidecar config

Pi state is stored separately from OpenCode at:

```text
~/.pi/agent/anthropic-auth.json
```

Override the path with `PI_ANTHROPIC_AUTH_FILE`. The package also respects `PI_AGENT_DIR` when deriving the default sidecar path.

The sidecar uses the same JSON shape as the OpenCode package, including `routing`, `claudeCache`, `cacheKeep`, `prime`, `claudeFast`, `thinkingBinding`, `dump`, `relay`, and fallback `accounts` blocks. `thinkingBinding.prefixMismatchBehavior` accepts `account-default` (default), `error`, or `drop_block` for OAuth Fable 5.1 replay. Runtime OAuth/quota state is stored in `anthropic-auth-state.json`; sticky session assignments are stored separately in `anthropic-auth-routing-state.json` with SHA-256-hashed session IDs.

## Commands

```text
/claude-cache
/claude-cache on
/claude-cache off
/claude-cache mode explicit
/claude-cache mode automatic
/claude-cache mode hybrid

/claude-cachekeep
/claude-cachekeep always
/claude-cachekeep 09-23
/claude-cachekeep off

/claude-prime
/claude-prime on
/claude-prime off

/claude-dump
/claude-dump on
/claude-dump off

/claude-fast
/claude-fast on
/claude-fast off

/claude-routing
/claude-routing main-first
/claude-routing fallback-first
/claude-routing sticky-balanced
/claude-routing reset

/claude-account
/claude-account reset-backoff

/claude-quota
```

`/claude-account reset-backoff` clears the main OAuth refresh backoff and its matching quota backoff. Persisted refresh backoffs are bound to the refresh token that produced them, so replacing a rejected credential immediately escapes its stale latch. `/claude-quota` reports sidecar OAuth fallback quota state from `~/.pi/agent/anthropic-auth.json`. `/claude-routing fallback-first` prefers usable OAuth fallback accounts before the main account; `/claude-routing main-first` restores the default. `/claude-routing sticky-balanced` assigns each Pi session to an OAuth account according to current 5-hour, 7-day, and matching model-scoped quota headroom, then persists that assignment across transient failures and process restarts. Changing the session model discards the old assignment before quota-based reselection. `/claude-routing reset` clears the current Pi session's assignment. Direct Opus sessions prefer usable accounts whose Fable quota is exhausted. API-key routes use the same sidecar shape as OpenCode and are sent directly to their configured Anthropic-compatible base URL, such as Kie's `https://api.kie.ai/claude`, but Pi only uses them after the main OAuth model response reports HTTP 429 or a streaming rate-limit error and a live quota check confirms 0% remaining. `/claude-cachekeep always` keeps active hybrid caches warm while Pi remains open; `/claude-cachekeep HH-HH` limits prewarms to a local time window. Both send `max_tokens: 0` pre-warm requests about five minutes before the 1-hour TTL expires. Running `/claude-cachekeep` without arguments lists live tracked sessions across Pi processes through a temporary lease registry that stores only session IDs and cache timing. `/claude-fast on` adds Anthropic `speed: "fast"` plus the `fast-mode-2026-02-01` beta header for supported Opus models (`claude-opus-4-8`, `claude-opus-5`, and `claude-opus-5-5`).

### Claude quota window priming

Priming is off by default. When enabled from OpenCode with `/claude-prime on`, it watches each OAuth account's 5-hour quota reset and sends one minimal `claude-haiku-4-5` request about one minute after a confirmed reset. This starts the next window without waiting for a normal prompt. Usage is measured from response accounting.

For an idle account with no cached reset time, one bootstrap request establishes the first observed window. Atomic temporary-file claims limit multiple processes sharing an account config to one request per account and reset.

Prime marker identities live in `anthropic-auth-state.json`. Plugin-owned refresh rotations preserve the main account's lineage, while a host credential replacement creates a new lineage. An existing main lineage without a refresh-token binding attaches to the current credential on its first check without changing identity. On upgrade, an existing fallback account receives an identity during its first prime check; that one-time marker change can send one extra request in the current window.

Pi's `/claude-prime` command displays status only. The `on` and `off` arguments are ignored; toggling priming requires OpenCode.

## Anthropic-compatible proxy overrides

API-key fallback routes honor `ANTHROPIC_CUSTOM_HEADERS`, `ANTHROPIC_MODEL`, and `ANTHROPIC_DEFAULT_{SONNET,OPUS,HAIKU,FABLE}_MODEL`. These variables never alter OAuth requests. Custom headers may add proxy metadata but cannot replace route authentication, Anthropic protocol headers, body framing, or internal correlation headers; a configuration containing an invalid or protected header is ignored as a whole. Versioned provider base paths are preserved without duplicating `/v1`.

## Relay

The Pi package can use the same user-owned Cloudflare relay config as the OpenCode package. The relay setup helper currently lives in the OpenCode package CLI:

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bunx @cortexkit/opencode-anthropic-auth relay setup
```

For Pi, copy the generated `relay` block into `~/.pi/agent/anthropic-auth.json`.

## License

MIT
