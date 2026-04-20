# Codebase Concerns

**Analysis Date:** 2026-04-20

Project Chris is currently post-v2.2 (M008 Episodic Consolidation, shipped 2026-04-19) with the M008.1 source-filter hotfix deployed 2026-04-19 after an Immich-entry overflow incident on production. Tech debt is unusually well-indexed because the project's retrospective and milestone-audit discipline explicitly carries it forward. This document consolidates what already lives in `.planning/STATE.md` "Known Tech Debt", the v2.2 milestone audit, the v2.2 retrospective ("Tech debt carried into v2.3+"), cross-milestone trends, and a static read of the largest / most-coupled source files.

Source grep for `TODO`/`FIXME`/`HACK`/`XXX` in `src/` returns zero matches — this codebase expresses debt in planning artifacts rather than inline code comments.

---

## Tech Debt

### Environmental: Vitest-4 fork-IPC hang under HuggingFace cache EACCES

- **Issue:** Full `bash scripts/test.sh` hangs on this class of environment (root-owned `node_modules/@huggingface/transformers` cache + `src/chris/__tests__/live-integration.test.ts` 401-retry loop triggers unhandled rejections under vitest-4 fork mode). Pre-existing since M006/M007.
- **Files:** `scripts/test.sh`, `src/chris/__tests__/live-integration.test.ts`, `src/chris/__tests__/live-accountability.test.ts`, `src/chris/__tests__/vague-validator-live.test.ts`, `src/chris/__tests__/contradiction-false-positive.test.ts`, `src/episodic/__tests__/live-anti-flattery.test.ts`
- **Impact:** Every milestone's Docker gate currently runs in "excluded-suite mitigation" mode — a 5-file exclusion list that exits 0 in ~28s. Every plan SUMMARY has to re-explain the mitigation. Friction compounds per-phase.
- **Fix approach:** Dedicated fix-up phase that (a) re-owns the HF cache at build-time to the container user, (b) wraps the 401-retry loop in bounded backoff, (c) re-audits vitest-4 fork mode config. Worth a 0.5-plan phase before M009 starts.
- **Status:** Pre-existing; documented in v2.2 retrospective as carry-forward; not a v2.2 regression.

### TD-BULK-SYNC-01: Bulk-sync overflow risk on initial Immich/Gmail/Drive backfill (M008.1 context)

- **Issue:** On 2026-04-19 Proxmox deploy, the initial backfill errored on 2026-04-15 with a 1.4M-token Sonnet overflow. Root cause: 23,977 Immich photo-asset rows in `pensieve_entries` for a single day vs 35 real Telegram entries. The consolidation prompt treated Immich metadata as journal content and blew the 1M-token Sonnet budget. A separate adjacent day (2026-04-17) produced a nonsense "three screenshots were captured" summary at importance=1.
- **Files:** `src/episodic/sources.ts` (L101-134 — `getPensieveEntriesForDay` now filters `source='telegram'` allowlist, M008.1 patch commit `2cfcecd`), `src/immich/sync.ts`, `src/gmail/sync.ts`, `src/drive/sync.ts`
- **Impact:** **Mitigated for consolidation specifically via the allowlist filter.** But the underlying asymmetry remains: bulk-sync can still dump tens of thousands of rows into `pensieve_entries` in a single window, which (a) skews any SQL-level aggregation by source (e.g., `hybridSearch` recency ranking), (b) inflates pgvector embedding storage with low-signal metadata, (c) will re-surface as a risk for M009 weekly review and M010+ profile inference if those consumers don't also explicitly filter by source. The M008.1 fix is an episodic-specific allowlist, not a system-wide rate limit.
- **Fix approach:** Either (a) per-source insert-rate governor on initial sync (batch size cap + day-bucket warning), or (b) propagate the `source='telegram'` allowlist pattern to every consumer that treats entries as "user authored" (retrieval routing, profile inference). Option (b) is the same architectural pattern — make source filtering a first-class query concern, not a per-subsystem retrofit.
- **Priority:** Medium. Contained for v2.2; re-audit at M009 planning time when weekly review starts aggregating.

### TD-GETRANGE-01: `getEpisodicSummariesRange` forward-only substrate

- **Issue:** Exported from `src/pensieve/retrieve.ts` and tested, but zero production callers in v2.2.
- **Files:** `src/pensieve/retrieve.ts` (`getEpisodicSummariesRange` export)
- **Impact:** Dead export until M009 weekly review consumes it. Not a bug — intentional forward substrate. Flagged in v2.2-MILESTONE-AUDIT.md `tech_debt` list.
- **Fix approach:** No action. Consumed by M009 Plan 01 (weekly review substrate).
- **Priority:** None — acceptable as-is.

### TD-RETRY-01: Phase 21 WR-02 retry-on-all-errors policy

- **Issue:** `callSonnetWithRetry` in `src/episodic/consolidate.ts` (L129-183) catches ANY error on the first call and retries once, instead of discriminating between "structured-output drift" (retryable) and "rate-limit / 5xx" (not retryable).
- **Files:** `src/episodic/consolidate.ts:129-183`
- **Impact:** On transient rate-limit, the retry fires once more against the same budget. Documented as a design choice (comment at L117-128): simpler than trying to discriminate SDK error classes. If rate-limit patterns emerge in prod, this doubles the exposure before cron gives up.
- **Fix approach:** M009+ revisit — classify `AnthropicError: overloaded_error` / 429 explicitly and skip the retry. Add a bounded exponential backoff if retries become frequent.
- **Priority:** Low (design choice, documented).

### TD-UAT-01: 12 human-UAT items carried from v2.1

- **Issue:** Human-in-the-loop UAT items from M007 never formally verified: live Telegram feel, ACCOUNTABILITY tone quality, `/decisions` dashboard format, FR/RU localization spot-check, TEST-13 / TEST-14 live runs require `ANTHROPIC_API_KEY`.
- **Files:** Surfaced in `.planning/MILESTONES.md` and v2.1-MILESTONE-AUDIT.md.
- **Impact:** Code is passing but unobserved in real usage by Greg. The M008 pause-gate (≥7 real summaries before M009) partially addresses this via forced accumulation.
- **Fix approach:** Dedicated UAT review once pause-gate clears; surface findings into M009 planning scope.
- **Priority:** Medium.

### TD-SUMMARY-FRONTMATTER-01: Plan SUMMARY.md frontmatter drift

- **Issue:** 12+ plan-level SUMMARY.md files in `.planning/milestones/v2.1-phases/` and `.planning/phases/20-..23-..` omit `one_liner:` / `requirements-completed:` frontmatter.
- **Files:** Various `**/SUMMARY.md` under `.planning/phases/` and `.planning/milestones/*-phases/`.
- **Impact:** `gsd-tools.cjs summary-extract` can't lift plan evidence into MILESTONES.md without manual review. Non-blocking but the hygiene floor has not risen phase-over-phase (v2.1 retrospective + v2.2 retrospective both cite it).
- **Fix approach:** One-shot mass backfill or make `/gsd-execute-phase` enforce the frontmatter shape on plan close.
- **Priority:** Low (operational only).

### TD-TOOLS-01: `gsd-tools.cjs audit-open` broken

- **Issue:** Throws `ReferenceError: output is not defined`.
- **Files:** External GSD tooling (not in this repo's `src/`).
- **Impact:** Pre-close artifact audit falls back to passed milestone audit. Silent failure mode.
- **Fix approach:** Upstream GSD fix.
- **Priority:** Low.

---

## Complexity Hotspots

### Large source files (non-test), ordered by LOC

| LOC | File | Concern |
|-----|------|---------|
| 488 | `src/proactive/sweep.ts` | Dual-channel orchestrator (accountability + reflective) × five triggers × escalation state machine. High fan-in on `src/proactive/state.ts` + `src/decisions/*`. Tested at 904 LOC in `__tests__/sweep.test.ts` + 560 LOC in `sweep-escalation.test.ts`. Most complex runtime module in the system. |
| 467 | `src/decisions/capture.ts` | 5-stage conversational capture state machine across EN/FR/RU. Single file owns `openCapture` + `handleCapture` + stage transitions. Risk: prompt-level regressions require live-Sonnet verification to detect. |
| 465 | `src/scripts/audit-pensieve.ts` | One-shot operator script; isolated. Less concerning — not on runtime path. |
| 433 | `src/pensieve/retrieve.ts` | 5 exports (`searchPensieve`, `getTemporalPensieve`, `hybridSearch`, `getEpisodicSummary`, `getEpisodicSummariesRange`). Re-exported through `src/pensieve/routing.ts` adapter. Every memory-consuming mode handler indirectly depends on this file. |
| 428 | `src/decisions/stats.ts` | Wilson CI math + SQL `FILTER` aggregations + Haiku accuracy classifier cache. Load-bearing for `/decisions` command. |
| 422 | `src/chris/engine.ts` | The central dispatcher. Imports from 18 modules. Every Telegram message passes through. See "Implicit Coupling" below. |
| 421 | `src/decisions/resolution.ts` | `classifyOutcome` + `handleResolution` + `handlePostmortem`. Fire-and-forget Pensieve writes for resolution/postmortem text (L348, L350, L417) — swallowed errors are silent. |

### High fan-in modules (imported by many consumers)

From `.planning/intel/files.json` cross-reference:

- `src/db/schema.ts` — imported by ~25 files. Single source of truth for 21 Drizzle tables. Any schema migration ripples across tests + handlers.
- `src/db/connection.ts` — imported by every subsystem that touches Postgres. `sql` and `db` are module-level singletons.
- `src/utils/logger.ts` — imported by virtually every module (pino singleton).
- `src/config.ts` — imported by 30+ files. Changes to `config` shape are global.
- `src/llm/client.ts` — imported by every mode handler, every Haiku classifier, and episodic consolidate. Model constants (`HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL`) hard-coded at module scope.

### High fan-out modules

- `src/chris/engine.ts` imports from 18 modules including ALL mode handlers, both pre-processors (mute/refusal/language), decision capture (capture-state + capture + resolution + triggers + suppressions), contradiction detection, praise quarantine, and personality. Adding a new engine step requires touching this file; removing one requires tracing 18 dependencies.
- `src/proactive/sweep.ts` imports from 16 modules; every trigger subsystem plus state + context-builder + prompts + bot + decisions lifecycle.
- `src/bot/bot.ts` imports 10 modules including all command handlers and the engine.

### Deeply nested conversational state

- `processMessage()` in `src/chris/engine.ts:149-422` is a 273-line function with ~9 sequential pre-processors (PP#0 active capture → PP#1 trigger detection → mute → refusal → language → mode detect → handler dispatch → praise quarantine → contradiction detection → save). The ordering is load-bearing; swapping any two steps changes behavior. Documented by D-24 / D-17 / SWEEP-03 decision IDs.
- `handleCapture` in `src/decisions/capture.ts` — 5 stage transitions, each with EN/FR/RU branches; capture draft JSONB has defensive `coerceValidDraft()` at the handler boundary (engine.ts:191 IN-04) because the TypeScript contract is not runtime-enforced at the DB layer.

---

## Implicit Coupling

### In-memory state that outlives requests

Several modules keep **process-local Maps** that survive across Telegram requests but die on container restart:

- `src/chris/engine.ts:32` — `surfacedContradictions: Map<chatId, Map<entryId, ts>>` with 24h TTL. Reset on restart means a user could re-see the same contradiction notice after redeploy.
- `src/chris/refusal.ts:15` — `sessionDeclinedTopics: Map<chatId, DeclinedTopicEntry[]>`. Declined topics are lost on restart.
- `src/chris/language.ts:15` — `sessionLanguage: Map<chatId, string>`. Short-message language fallback chain resets on restart, degrading for the first few messages post-deploy.
- `src/bot/handlers/sync.ts:99` — `pendingOAuthCodes: Map<chatId, true>`. If a user starts the OAuth flow, then the container restarts before the callback arrives, the flow is silently broken.

**Impact:** Each redeploy silently degrades user experience for up to 24h. Not a bug — documented design — but the design is implicit across four files rather than centralized.

**Fix approach:** If any of these ever needs persistence, the pattern is already established in `proactive_state` (key-value JSONB table). Migrating would be straightforward per-Map.

### Three crons on one timezone

`config.proactiveTimezone` drives:
1. Sync scheduler (`syncIntervalCron`, every 6h)
2. Proactive sweep (`proactiveSweepCron`, default 10:00 local)
3. Episodic consolidation (`episodicCron`, default 23:00 local)

All three are `cron.schedule(..., { timezone: config.proactiveTimezone })` in `src/index.ts:73/89` and `src/sync/scheduler.ts:94`. DST transitions affect all three on the same day.

**Impact:** A single `config.proactiveTimezone` typo breaks the entire temporal scheduling surface. `src/episodic/cron.ts:93-121` wraps `computeYesterday` in a try/catch specifically because `Intl.DateTimeFormat` raises `RangeError` on bad tz strings — good defensive pattern, but other consumers (`src/proactive/state.ts`, `src/pensieve/retrieve.ts` via `formatLocalDate`) do NOT have the same defense.

**Fix approach:** Validate `config.proactiveTimezone` at boot via a single `DateTime.local().setZone(tz).isValid` check in `src/config.ts`. Fail-fast on startup is strictly cheaper than partial-cron silent failure.

### `bot.api.sendMessage` called from non-bot subsystems

Error notification paths in `src/episodic/notify.ts`, `src/sync/scheduler.ts`, and `src/proactive/sweep.ts` all import `bot` from `src/bot/bot.ts` to send Telegram messages.

**Impact:** If `src/bot/bot.ts` module initialization fails (bad `TELEGRAM_BOT_TOKEN`), these subsystems can't even report their own errors. Circular dependency risk: bot imports engine indirectly, engine imports proactive state, proactive sweep imports bot.

**Fix approach:** Extract a thin `src/bot/notify.ts` interface that only needs the bot token, not the full Grammy instance. De-risks the circular import trajectory.

---

## Brittleness / Test-Gap Risks

### Prompt-level regressions only visible under real Sonnet

v2.0 / v2.1 / v2.2 have each added live-integration tests (`src/chris/__tests__/live-integration.test.ts`, `live-accountability.test.ts`, `vague-validator-live.test.ts`, `src/episodic/__tests__/live-anti-flattery.test.ts`). **All five are gated by `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`** and all five are on the excluded-suite list because of the fork-IPC hang.

- **Risk:** Every consolidation-prompt tweak, every constitutional-preamble change, every mode-prompt shift is unverified against real Sonnet unless someone manually runs with `ANTHROPIC_API_KEY` set.
- **Files:** 5 live-test files (listed above).
- **Priority:** High. M009 will add ritual prompts + weekly review prompts — both prompt-heavy. Need a sustainable live-test runner before M009 ships.
- **Fix approach:** Either CI that runs live tests on a nightly schedule, or a `scripts/test-live.sh` that pulls `ANTHROPIC_API_KEY` from `.env` and runs the 5 live files explicitly.

### Mock-chain drift between unit tests and real Drizzle

Post-closure addendum in the v2.1 retrospective documents that 45 engine-test failures were initially mis-attributed as pre-existing until a code-review pass showed the real root cause: Phase 14's new `.where().limit()` chain without `.orderBy()` did not match the unit-test mock (which only supported `.where().orderBy().limit()`).

- **Files:** `src/chris/__tests__/engine.test.ts`, `engine-mute.test.ts`, `photos-memory.test.ts` (the last two still carry the same mock-chain gap per v2.1 retrospective).
- **Risk:** Any new call site that adds/changes a Drizzle query chain can silently break unit-test mocks while Docker integration still passes. "Pre-existing" is not reliably provable via rollback+rerun.
- **Fix approach:** Mandated new-call-site-vs-mock-coverage checklist in `/gsd-execute-phase` for every phase that touches `.select()`, `.insert()`, `.update()`, or `.delete()`.

### Boundary audit guard only covers 3 files

`src/chris/__tests__/boundary-audit.test.ts` greps for `\bepisodic_summaries\b|\bepisodicSummaries\b` in exactly 3 files (`personality.ts`, `ground-truth.ts`, `embeddings.ts`). The boundary invariant (D035) — "summary text NEVER enters Known Facts or pensieve_embeddings" — is enforced structurally only for those three files.

- **Risk:** A future file (M009 daily-note handler? M010 profile inference?) could import `episodicSummaries` for legitimate reasons, but then accidentally cross the boundary by joining summary text into a Known-Facts-shaped output. The audit would not catch it.
- **Fix approach:** Extend the audit file list when M009/M010 introduce new candidate boundary-crossers. Pattern is documented (v2.2 retrospective "Boundary audit via grep test").

### Zero unit coverage for container-restart edge paths

The four in-memory Maps listed under "Implicit Coupling" have no unit tests that assert the restart-degradation behavior. There is no test that says "after container restart, surfacedContradictions is empty and the same contradiction can re-fire."

- **Risk:** If a future change adds persistence to one of these Maps (e.g., someone moves `declinedTopics` to the DB), no test catches the resulting behavior change.
- **Fix approach:** Low priority — document in `.planning/codebase/CONVENTIONS.md` rather than add tests.

### Fire-and-forget writes swallow errors

Resolution / postmortem writes to Pensieve use `.catch(err => logger.warn(...))`:

- `src/decisions/resolution.ts:348, 350, 417` — Pensieve write failures are logged at `warn` level, not surfaced to the user.

**Risk:** A failed Pensieve write for resolution/postmortem content means the decision is resolved but its post-mortem narrative is never archived. Recovery requires log-diving. Consistent with the documented "Never block" contract (D005), but the failure modes do not reach the operator naturally.

**Fix approach:** Consider escalating Pensieve-write failures to `bot.api.sendMessage` on the same "operational notification" channel already used by `notifyConsolidationError`. Same infrastructure.

---

## Operational Concerns

### Source-filter allowlist is the only barrier against bulk-sync overflow (post-M008.1)

**Context:** The M008.1 hotfix added `eq(pensieveEntries.source, 'telegram')` to `getPensieveEntriesForDay()` in `src/episodic/sources.ts:101-134`. This is an **allowlist** — a newly added sync source (future voice-upload, document-upload, browser history) is excluded by default until the constant is updated.

- **Current mitigation:** Allowlist is narrow (only `'telegram'`), so ambient sources can't pollute episodic consolidation.
- **Operational gotcha:** The same allowlist pattern is NOT applied in `src/pensieve/retrieve.ts` / `src/pensieve/routing.ts`. `hybridSearch` still returns results from all sources. This is intentional per D011 (source provenance) and the citation model, but means a naive `hybridSearch` query during a bulk-sync window could rank Immich metadata over real Pensieve content.
- **Watch for:** M009 weekly review should either adopt the same allowlist or explicitly weight by source.

### Cron DST safety is defended by idempotency, not by cron library

`src/index.ts:89-95` schedules the episodic cron with `{ timezone: config.proactiveTimezone }`. On fall-back (2026-10-25 in Paris), node-cron's timezone handling fires once per local hour:minute. On spring-forward, the cron expression `"0 23 * * *"` still fires at 23:00 local.

- **Defense in depth:** The *real* DST-safety guarantee is `UNIQUE(summary_date)` on `episodic_summaries` (D034) + pre-flight SELECT in `src/episodic/consolidate.ts:216-227` + `ON CONFLICT DO NOTHING` at L294. Any duplicate fire collapses to a no-op.
- **Gotcha:** The proactive sweep cron at `config.proactiveSweepCron` does NOT have the same DB-level idempotency. It uses `hasSentTodayReflective` / `hasSentTodayAccountability` in-process state (`src/proactive/state.ts`) backed by `proactive_state` JSONB. A fall-back double-fire could theoretically send two proactive messages if the first "today" state write fails. Probability low; not currently tested.
- **Fix approach:** DST scenario test for proactive sweep, parallel to `src/episodic/__tests__/cron.test.ts` DST cases.

### Migration ordering is hand-audited, not enforced

`scripts/test.sh` applies six migrations in order (0000 → 0005). Drizzle-kit snapshot lineage was broken mid-v2.1 (TECH-DEBT-19-01) and resolved by `scripts/regen-snapshots.sh` using clean-slate iterative replay on a throwaway Docker volume.

- **Current state:** Snapshot chain is byte-accurate (v2.1 Phase 20 Plan 01 closure — drizzle-kit generate emits "No schema changes").
- **Operational gotcha:** `scripts/regen-snapshots.sh` has an EXIT trap that was fixed in Phase 20 WR-02 (commit `4950f2b`) because a re-run could destroy committed `0005_snapshot.json`. The `REGEN_PRODUCED_0005` flag guards it now, but the pattern of "shell-script EXIT trap manipulating committed files" is fragile.
- **Fix approach:** Consider replacing `regen-snapshots.sh` with a TypeScript orchestration script that uses a temp git worktree, so committed files are never at risk.

### Pensieve append-only invariant enforcement is soft

D004 ("Append-only Pensieve, no lossy operations") is enforced primarily by convention. The `deletedAt` column on `pensieve_entries` implements soft-delete. There is no DB-level trigger that forbids `UPDATE` or `DELETE` on the table.

- **Risk:** A future operator script (or a bug in Drizzle schema codegen) could issue a hard DELETE. Test cleanup in fact does issue DELETEs (`eq(pensieveEntries.source, 'telegram')` cleanup races were the original motivation for `fileParallelism: false` in vitest.config.ts).
- **Fix approach:** Consider Postgres RLS or a `BEFORE DELETE` trigger that logs + rejects on `source != 'test-fixture'`. Defense in depth for the load-bearing invariant.

### Source='telegram' filter assumes zero legacy non-telegram user content

M008.1 filter assumes ALL user-authored Pensieve entries carry `source='telegram'`. Document-upload through the Telegram doc handler also ends up as `source='telegram'` (via `src/bot/handlers/document.ts` → `storePensieveEntry`). Audit backfill uses `source='audit'` (per v2.0 Phase 6).

- **Risk:** If a future source is added that SHOULD drive consolidation (e.g., voice transcription, browser clipper), it needs to be explicitly added to the allowlist in `src/episodic/sources.ts:120`. Easy to forget.
- **Fix approach:** Promote the allowlist into a named constant (`USER_AUTHORED_SOURCES`) in a shared module, so both `getPensieveEntriesForDay` and any future consumer (M009 weekly review) use the same literal.

### Orphaned-export check is now an audit gate, but not automated

v2.2 audit caught `retrieveContext` as an orphaned export (shipped in Phase 22, no chat-mode handler imported it). Gap-closure Phase 22.1 fixed it. v2.2 retrospective Lesson #1 codifies "for every new exported function, integration check asserts at least one non-test caller."

- **Current state:** Manual audit, run during `/gsd-complete-milestone`.
- **Risk:** Easy to miss on smaller phases that don't go through full milestone audit.
- **Fix approach:** `.planning/intel/files.json` already has full import graph. A `gsd-tools.cjs orphan-check` command would be a 50-line script. Worth building during TD-TOOLS-01 cleanup.

---

## Scaling Limits

### Single-user design

D009 locks Chris to a single authorized Telegram user ID. Auth middleware (`src/bot/middleware/auth.ts`) silently drops everything else.

- **Current capacity:** 1 user.
- **Architecturally:** `episodic_summaries` has no `chat_id` column (unique constraint is on `summary_date` alone — D009 rationale documented in STATE.md Plan 23-03). `pensieve_entries` has no `chat_id`-keyed partition. Multi-tenancy would require schema migration across 8+ tables.
- **Scaling path:** Out of scope per PRD. Not a concern — explicitly excluded.

### LLM budget

- **Haiku calls per Telegram message:** ~1-3 (mode detect always; mute detect if keyword; stakes classify if trigger phrase). Per-day ceiling bounded by Greg's message volume.
- **Sonnet calls per day:** 1 consolidation + N mode handler responses where N = Greg's message count. No rate limit in place.
- **Opus calls per day:** ≤2 (pattern + thread triggers in proactive sweep, gated by SQL cheap-checks per D010).
- **Limit:** Anthropic tier rate limits. Not currently instrumented — no token-usage aggregation, no cost alerting.
- **Scaling path:** If Greg's usage grows significantly, token-usage instrumentation is the first step. Currently blind.

### Pgvector performance

- **Current state:** `pensieve_embeddings.embedding` is `vector(1024)`. No HNSW or IVFFlat index declared in `src/db/schema.ts` (verify). `cosineDistance` is full scan.
- **Current scale:** On 2026-04-15, a single day saw 23,977 Immich assets. Cumulative embedding count over 6+ months of multi-source sync will be in the 100k-1M range.
- **Risk:** Retrieval latency degrades linearly with table size until an index is added.
- **Fix approach:** Add `USING hnsw (embedding vector_cosine_ops)` index in a new migration. Measure baseline retrieval latency first, then add index, then re-measure. Low urgency until latency becomes user-visible.

---

## Dependencies at Risk

### `@huggingface/transformers` ONNX cache ownership

Root-owned cache in `node_modules/@huggingface/transformers/.cache` is the proximate cause of the excluded-suite-mitigation tech debt (see TD top section). Package itself is fine; the install footprint is the problem.

### `drizzle-kit` meta snapshot lineage

Already resolved (TECH-DEBT-19-01 closed) but the fragility remains: `scripts/regen-snapshots.sh` exists specifically because drizzle-kit does not idempotently regenerate meta for already-applied migrations.

### `zod/v4` + `@anthropic-ai/sdk/helpers/zod` bridge

`src/episodic/consolidate.ts:75-81` maintains a hand-mirrored v4 schema `EpisodicSummarySonnetOutputSchemaV4` alongside the authoritative v3 schema in `src/episodic/types.ts`, because the SDK runtime calls `z.toJSONSchema()` which only accepts v4. Documented drift risk (comments at L53-74). If the v3 schema is tightened and the v4 mirror isn't updated in the same commit, Sonnet validation silently diverges from insert validation.

- **Fix approach:** Migrate fully to `zod/v4` once the SDK's `.d.ts` catches up. Until then, a lint rule or a pre-commit check that greps both files for schema-shape parity.

### `pdf-parse` + `html-to-text`

Used by `src/utils/file-extract.ts` for Telegram document ingestion. Both are stable; no known CVE status. Not recently audited.

---

## Missing Critical Features

### No per-source rate limit / back-pressure

Sync cron (`src/sync/scheduler.ts`) fires every 6h. Gmail/Drive/Immich each bulk-insert without a per-sync ceiling. First-time backfill can dump tens of thousands of rows (see TD-BULK-SYNC-01).

- **Fix approach:** Cap single-sync insert count; if ceiling hit, notify + defer remainder to next tick.

### No instrumentation for LLM token usage or cost

Not logged, not aggregated. Scaling limits section above covers this — currently blind.

### No backup/restore runbook in-repo

Production snapshot taken manually to `/root/chris-backups/chris-pre-v2.2-20260419-145108.dump` per STATE.md. No documented cadence, no automated rotation, no tested restore procedure. Single-host Proxmox deployment means one disk failure = data loss.

- **Fix approach:** `scripts/backup.sh` + cron entry on Proxmox + restore smoke test. Non-negotiable for production data that users trust as their memory of record.

---

## Test Coverage Gaps

### Live-API test files all gated behind excluded-suite

See "Brittleness" above. 5 live test files are present but Docker gate cannot run them.

### DST boundary coverage

`src/episodic/__tests__/cron.test.ts` covers spring-forward + fall-back for episodic consolidation. `src/proactive/__tests__/sweep.test.ts` does NOT have equivalent DST simulation for the proactive sweep daily-cap state.

### Bulk-sync overflow regression test

M008.1 fix adds `Test 4b: getPensieveEntriesForDay excludes non-telegram sources`. But no test simulates the actual failure mode (24k entries → 1.4M-token Sonnet overflow). Would require a fixture larger than the current 14-day synthetic fixture.

### In-memory Map restart behavior

Zero coverage for the four in-memory Maps (engine.ts, refusal.ts, language.ts, sync.ts). Restart-degradation is documented behavior with no test.

### Container-startup health probe

`/health` endpoint in `src/index.ts:17-57` tested only by `docker-compose` healthcheck curl. No unit test.

---

## Priority Summary (Top 5 for M009 pre-work)

1. **HIGH — Live-API test runnability.** Before M009 ships prompt-heavy ritual + weekly review code, the 5 live test files need a reliable runner. Fork-IPC hang fix-up phase OR `scripts/test-live.sh` dedicated path.
2. **MEDIUM — Bulk-sync governance pattern.** M008.1 allowlist is a local fix. M009 weekly review + M010 profile inference will re-encounter the same asymmetry unless the source-filter pattern is centralized.
3. **MEDIUM — Tz config validation at boot.** One bad `config.proactiveTimezone` breaks three crons silently. Fail-fast in `src/config.ts` is cheap.
4. **MEDIUM — Human-UAT pass on v2.1 + v2.2 carry-forward items.** 12 deferred items should be reviewed before M009 builds on top of them.
5. **LOW — Pensieve append-only DB-level enforcement.** Trigger-based enforcement for the load-bearing invariant. Defense in depth.

---

*Concerns audit: 2026-04-20*
