# @cortexkit/pi-anthropic-auth

Pi package for CortexKit Anthropic OAuth support. It overrides Pi's built-in `anthropic` provider with the display name `Anthropic (CortexKit)` and a CortexKit provider extension backed by the shared `@cortexkit/anthropic-auth-core` package.

The provider maps Anthropic's Claude Code tool-name aliases back only through the exact tool-name snapshot sent in that request. Ambiguous aliases fail before dispatch; unknown response names remain unknown rather than being case-folded onto an executable host tool.

The Pi provider catalog is derived from the pinned Pi SDK's Anthropic catalog. CortexKit clones those entries and preserves their metadata except for API identity, first-party base URL, supported thinking levels and SDK automatic-warming lifetimes. The account-side cache policy does not implement the SDK's `cacheRetention` contract, so CortexKit does not advertise `promptCache` lifetimes to the SDK's separate warming scheduler. Explicit CortexKit `cacheKeep` remains the sole warming owner. It admits the current Fable 5/5.1, Opus 5/5.5/4.8/4.5, and Sonnet 5/5.5/4.5 entries, plus Haiku 4.5 and dated Haiku 4.5, Opus 4.5, and Sonnet 4.5 entries whose legacy thinking request shapes pass local captures. Opus 4.6/4.7 and Sonnet 4.6 remain unavailable in this Pi catalog because CortexKit's converter emits token-budget thinking while those SDK entries use adaptive effort. Mythos 5 and 5.1 remain explicit CortexKit additions until the pinned SDK lists them; their pricing and labels are CortexKit-owned. SDK catalog changes do not automatically imply subscription entitlement.

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

### Prompt-cache correctness and validation

The converter normalizes **every** user turn into non-empty content blocks before placing cache markers. This includes later plain-text messages, host notifications and compacted summaries, not just the first user message. The static tool/system/initial-prompt anchors and moving conversation anchor use at most four protocol breakpoints. Tool arguments named `cache_control` are not breakpoints. Images, tool results and valid signed thinking retain their replay contracts; tests inspect the final serialized request and stable historical prefixes.

The Pi/Tron integration defaults to **one-hour explicit caching with no setup commands**. An existing explicit `claudeCache.enabled: false` is preserved, and OpenCode's defaults are unchanged. `/claude-cache` only inspects status; `/claude-cache on` and `/claude-cache mode explicit` are optional overrides, not installation steps. Changing only the mode preserves the effective enabled/off choice transactionally. This applies to **all sessions sharing this sidecar**, including subagents and API-key fallback routes; it is not a per-chat setting. `off` restores five-minute caching rather than disabling caching. `automatic` replaces the static anchors with one top-level marker; `hybrid` uses the same explicit anchors and can opt into CortexKit's separate cache keeper. Enabling one-hour caching never enables cache keeping, fast mode or quota priming. One-hour writes cost more than five-minute writes, so use them when gaps justify the longer retention. Configuration is read for each request; changing it does not rewrite an in-flight request.

`stream.ts` retains the response's five-minute/one-hour cache-write split across partial SSE usage events. A complete split prices writes at 1.25x/2x the model's base input price, without changing catalog metadata or the canonical usage schema. Missing or inconsistent breakdowns retain the catalog estimate and are explicitly labelled `catalog-estimate` in diagnostics. These are API-price estimates, **not subscription-quota accounting**. Errors after usage was received preserve that usage.

The existing rotating CortexKit log has a `pi-cache` channel:

- `request cache coverage`: debug normally, warning when a non-empty conversation has no cache marker; model, response request ID, status, configured mode/extended TTL, serialized request bytes, breakpoint counts and conversation coverage only.
- `response cache usage`: info once per metered stream (including partial failures and non-chat calls such as compaction); token counters, returned TTL breakdown, stop reason and write-pricing basis only.

No prompt, tool result, credential, request body or signed thinking is logged by these events. Full request dumping is neither required nor enabled. The logger's existing location/rotation controls apply. Byte size is diagnostic: caching still transmits the history, and provider size errors must continue through the host's existing compact-and-retry recovery, not silent image deletion.

Focused regressions: `src/tests/cache.test.ts`, `convert.test.ts`, `commands.test.ts` and the core's `config-transactions.test.ts`. The cache matrix must fail on an uncorrected converter; a green first-turn-only test does not establish coverage. Run the package's normal test/typecheck/build commands, then run `bun run check:pi-package <core.tgz> <pi.tgz>` (Node 22.18+). This validates the packed extension through the real SDK extension loader in a temporary, credential-free profile with network access blocked. Local `1.23.1-tron.7` requires the accompanying `@cortexkit/anthropic-auth-core@1.23.1-tron.1` artifact; neither version is published. Adopt both through the host's package-management owner, not edits to installed JavaScript. Package installation uses the host's package-management owner; no Gateway binary rebuild or restart is required for global provider-resource reconciliation. Already-open project runtimes may retain their loaded extension until their normal resource reload.

Offline success does not prove server caching. After adoption, an explicitly authorized small fresh-session canary should hold model, effort, tools and instructions fixed, cover text → tool result → notification → tool result, and verify returned cache reads after a 6–7 minute gap. Bound calls/output and stop on errors; no retry loop or cache prewarming to force a pass. Validate semantic output and time-to-first-token as well as cache usage. Account for legitimate invalidation after model/tool/prompt changes, compaction or TTL expiry; do not infer subscription savings from displayed dollars.

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
