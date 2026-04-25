# Phase 24: Primed-Fixture Pipeline — Context

**Gathered:** 2026-04-20
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults auto-selected for each gray area)

<domain>
## Phase Boundary

Phase 24 delivers the organic+synthetic primed-fixture pipeline: an operator can produce a fused test fixture — anchored in real prod data pulled from Proxmox (192.168.1.50), extended with deterministic synthetic days via Haiku style-transfer + real `runConsolidate()` episodic synthesis — and load it into the Docker Postgres test DB through `loadPrimedFixture(name)`. The pipeline auto-refreshes stale snapshots (> 24h) silently, is seed-reproducible via VCR-cached Anthropic outputs, and is documented with a new project convention banning calendar-time data-accumulation gates in subsequent milestones.

**In scope (from REQUIREMENTS.md):**
- Organic data fetch (FETCH-01..05) — `scripts/fetch-prod-data.ts`
- Synthetic delta generation (SYNTH-01..07) — `scripts/synthesize-delta.ts`
- Test harness integration (HARN-01..03) — `src/__tests__/fixtures/load-primed.ts`
- Freshness + reproducibility (FRESH-01..03) — 24h auto-refresh + `--no-refresh` + `regenerate-primed.ts`
- Documentation (DOC-01..02) — TESTING.md + new project convention

**Out of scope** (deferred to future milestones):
- Synthetic image generation for Immich paths
- Synthetic voice transcripts
- Cross-environment snapshot migration (prod→staging)
- Automatic regression detection on snapshot diff
- PII scrubbing (single-user system)
- Synthetic sources other than `source='telegram'`

</domain>

<decisions>
## Implementation Decisions

### DB access method for fetch script (D-01)

**D-01:** `scripts/fetch-prod-data.ts` uses a **Node + Drizzle script over a direct Postgres connection through SSH port-forward** — NOT shell pg_dump or psql COPY.

- **Rationale:** Reuses the existing `src/db/schema.ts` Drizzle definitions so column types stay accurate; single TypeScript file, no shell-script brittleness; matches the existing ESM+TS convention across all other scripts (`backfill-episodic.ts`, `regen-snapshots.sh` are the only two scripts and the .ts one is the clear precedent).
- **Mechanism:** `ssh -L 15432:localhost:5432 root@192.168.1.50 -N &` background tunnel, then connect via `postgres('postgres://chris:...@localhost:15432/chris')`. Tunnel torn down in `finally`. Matches the pattern the operator uses manually today.
- **Output format:** JSONL per table (one JSON object per line), stable ORDER BY primary key for diffability.
- **Rejected alternatives:**
  - Shell `pg_dump | jq`: loses type information, hard to post-filter cross-referenced rows (embeddings joined to telegram pensieve entries).
  - `psql \copy to JSON`: double-quote escaping hell across multi-line pensieve entries.
  - Remote node script via docker exec: coupling to prod container lifecycle; fragile.

### Haiku style-transfer prompt structure (D-02)

**D-02:** Synthetic pensieve entries are generated via a **per-day Haiku prompt** — one call per synthetic day, NOT a batch call spanning all N days and NOT a per-entry one-to-one transfer.

- **Rationale:** Per-day is the existing M008 consolidation cadence; matches M006 Haiku prompt pattern (single prompt, bounded few-shot examples, deterministic with `temperature=0` + seeded sampling); avoids batch failure modes where one bad day poisons 13 others; per-entry is too expensive and loses day-coherence (entries should feel like they came from the same day's thread-of-consciousness).
- **Prompt shape:** System prompt describes Greg's voice (sampled from ≥5 random organic telegram entries as few-shot). User message asks for N synthetic entries for a specified synthetic date, in JSON array form. Zod-parsed via `@anthropic-ai/sdk/helpers/zod` `zodOutputFormat` (same surface M008's consolidation uses).
- **Seed plumbing:** `seededShuffle(organicEntries, seed)` selects few-shot examples deterministically; Anthropic `temperature=0` makes its output near-deterministic; the VCR cache (D-03) closes the remaining gap.
- **Cost:** ~50 tokens out/entry × ~10 entries/day × 14 days × Haiku rate = ~$0.02/day. Negligible.

### VCR cache layout (D-03)

**D-03:** LLM outputs are cached in a **content-addressable hash-keyed store** under `tests/fixtures/.vcr/<sha256-of-prompt-input>.json`.

- **Rationale:** Hash key is the full prompt input (system + user + tool-use schema), so any prompt change automatically invalidates — no manual cache-busting; single shared directory across all fixtures = one place to clear; gitignored alongside `prod-snapshot/`. Co-located next to fixture directories was rejected because identical prompts across fixtures would duplicate cache entries.
- **Hit path:** `cachedAnthropicCall(input) → hash(input) → if cache hit return json, else call, write, return`. Wraps both Haiku (D-02) and Sonnet (via `runConsolidate`, D-04).
- **Miss path:** Real API call. Writes cache atomically (write to tmp + rename). First-run cost amortized; reruns free.
- **Cache invalidation:** Automatic on prompt change (hash mismatch). Manual `rm -rf tests/fixtures/.vcr` or `regenerate-primed.ts --force` for full rebuild.

### Real-engine episodic synthesis (D-04)

**D-04:** Plan 24-03 runs the **actual** `runConsolidate(date)` from `src/episodic/consolidate.ts` against each synthetic day — NOT a mock, NOT a re-implementation.

- **Rationale:** The engine under test must produce the fixture's summaries. Any divergence between fixture-generation consolidation and production consolidation is a latent bug source. This is the single most important design choice in the pipeline: *the engine we ship is the engine that produces our test data.*
- **Wrapping:** Sonnet calls routed through the VCR wrapper (D-03) so re-runs are free. The Haiku outcome-classification calls inside M007 decision flow are similarly wrapped if Plan 24-02 synthesizes resolved decisions.
- **DB isolation:** Synthesis runs against a temporary Docker Postgres container on port 5434 (precedent: `scripts/regen-snapshots.sh`) so fixtures don't contaminate the developer's regular test DB. Container is torn down after the fixture write.
- **Idempotency preserved:** `UNIQUE(summary_date)` + CONS-03 pre-flight SELECT means re-running synthesis over the same day is a safe no-op.

### Wellbeing schema strategy (D-05)

**D-05:** SYNTH-06 wellbeing synthesis **feature-detects** the `wellbeing_snapshots` table at runtime: if the table exists (i.e. M009 has landed its migration), synthesize rows into it. If not, log a one-line skip and proceed.

- **Rationale:** v2.3 ships independently of M009 — shipping a schema ahead of its consumer milestone is premature and would force backfill/migration coordination. Feature-detection makes v2.3 forward-compatible: when M009 adds the table, no v2.3 code change is needed.
- **Mechanism:** `SELECT to_regclass('public.wellbeing_snapshots') IS NOT NULL` at the start of the wellbeing synth step. Skip is logged at `info` level (not warn) since absence is expected pre-M009.
- **Rejected:** shipping a v2.3 migration 0006 to add the table would couple v2.3's scope to M009's schema decisions and would require M009 to reconcile its own version of the schema on arrival.

### Freshness helper location (D-06)

**D-06:** The 24h-staleness check lives in a **shared helper module** `src/__tests__/fixtures/freshness.ts` — NOT inlined in each script's `main()`.

- **Rationale:** Three consumers — `synthesize-delta.ts`, `regenerate-primed.ts`, and the test harness `loadPrimedFixture()`'s diagnostic output — all need the same logic. DRY + single locus of testing + future tunability (e.g. 24h could later be config-driven).
- **Surface:** `isSnapshotStale(path: string, ttlHours = 24): boolean`, `autoRefreshIfStale(path, opts): Promise<string>` (returns path to fresh snapshot). `autoRefreshIfStale` respects `--no-refresh` via an options param.
- **Lives under `src/__tests__/fixtures/` not `scripts/`** because it's also imported by `loadPrimedFixture` (HARN-01) for its own diagnostic message, and the test-harness location signals its primary audience.

### Organic→synthetic date mapping (D-07)

**D-07:** Synthetic days **follow** the organic span (strict chronological extension). Example: organic snapshot contains 2026-04-15..18 (4 days), `--target-days 14` → synthesize 2026-04-19..28 (10 new days) for a fused 14-day span.

- **Rationale:** Simplest mental model; zero collision risk with organic data (organic UNIQUE(summary_date) rows stay authoritative); matches how real time works (synthesis is always forward-in-time from prod state).
- **Edge case:** If `--target-days N < organic span`, synthesis produces 0 new days and the fused fixture is just the organic data truncated to the requested span (most-recent-first).
- **Rejected:** Overlap/gap-filling was tempting for creating continuous spans from sparse organic, but adds collision complexity (what happens if organic has 2026-04-15 imp=8 and synth wants to overwrite?) and loses the diagnostic clarity of "synth days are strictly after day X".

### Error handling for fetch-prod-data unreachable (D-08)

**D-08:** `fetch-prod-data.ts` **hard-fails** with a clear error if Proxmox is unreachable or the SSH tunnel can't establish. No fallback to last LATEST, no retry loops.

- **Rationale:** Silent fallback to stale data defeats the purpose of the 24h auto-refresh contract (FRESH-01). If prod is unreachable, the operator should know immediately and decide (retry, use `--no-refresh`, or investigate prod health).
- **Message:** `"fetch-prod-data: unable to reach Proxmox at 192.168.1.50 (check VPN, SSH agent, or prod health). Use --no-refresh to force-use stale LATEST snapshot at <path> (last updated: <ISO>)."`
- **Exit code:** 1.

### Test-runner integration (D-09)

**D-09:** `loadPrimedFixture()` does NOT auto-invoke freshness auto-refresh during test runs. Tests that use primed fixtures fail loud with a clear error if the snapshot is stale; the operator refreshes at fixture-generation time via `synthesize-delta.ts` or `regenerate-primed.ts`, not mid-test-run.

- **Rationale:** FRESH-01's auto-refresh scope is explicitly `synthesize-delta.ts` and `regenerate-primed.ts` — the scripts that *produce* the fused fixture. Auto-fetching during `vitest` adds 30+ seconds of network I/O to every test startup and couples tests to network/VPN state. Tests should be hermetic: fixture in, assertion out.
- **Failure mode:** If `loadPrimedFixture` is called with a fixture whose embedded organic snapshot is > 24h old, it still loads (tests aren't blocked by stale organic) but logs a one-line warning at `warn` level: `loadPrimedFixture('x'): organic snapshot is N hours old — consider running regenerate-primed.ts --milestone x --force`.
- **Strictness toggle:** A `{ strictFreshness: true }` option on `loadPrimedFixture` can be added if a future test needs to hard-fail on stale fixtures.

### SSH auth pattern (D-10)

**D-10:** SSH uses the **existing operator key** at `~/.ssh/` (whatever the operator uses today to SSH to Proxmox). No new credentials; no env-var `SSH_KEY_PATH` override in v2.3.

- **Rationale:** Per REQ FETCH-03 "no new credentials introduced". The operator already has working SSH to 192.168.1.50; the script inherits that.
- **Revisit:** If CI ever runs `fetch-prod-data.ts` (unlikely given single-developer system), an env-var override becomes necessary — defer until needed.

### FK-safe cleanup order for loadPrimedFixture (D-11)

**D-11:** `loadPrimedFixture` clears target tables in **strict reverse-FK order** before loading:

```
conversations
  → contradictions
  → pensieve_embeddings
  → decision_events
  → episodic_summaries
  → decision_capture_state
  → decisions
  → pensieve_entries
  → proactive_state
  → memories
  → wellbeing_snapshots (if table exists; D-05 feature detection)
```

- **Rationale:** Matches the existing test-cleanup precedent in `src/episodic/__tests__/consolidate.test.ts` and `src/decisions/__tests__/synthetic-fixture.test.ts`. Pensieve embeddings reference pensieve entries; decision events reference decisions; contradictions reference pensieve entries. Reverse-FK delete prevents 23503 violations.
- **Bulk insert** uses the same order reversed: parents → children.
- **Scoping:** Unlike Phase 23 per-test cleanup-by-source, loadPrimedFixture clears ALL rows (it's loading a full fixture, not augmenting existing data). Tests that want to preserve rows from a prior suite use `source=`-scoped cleanup instead.

### Claude's Discretion

- Snapshot directory naming: ISO8601 with timezone (`2026-04-20T14-30-00Z`) vs compact (`20260420-143000`) — Claude picks whatever reads well in `ls`; no user preference.
- Exact few-shot sample size for Haiku style-transfer (D-02) — plan can tune between 5–15 based on organic-base richness.
- Exact number of deterministic contradiction pairs in SYNTH-05 (N=?) — plan decides based on what M009 weekly-review tests will need; 3–5 pairs likely sufficient.
- Log-line format for the feature-detection skip (D-05) — any structured log line is fine.

### Folded Todos

*No pending todos matched Phase 24's scope.*

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 24 spec + requirements
- `M008.5_Test_Data_Infrastructure.md` — authoritative spec (5 deliverable sections, out-of-scope list, phase shape)
- `.planning/REQUIREMENTS.md` — 20 REQ-IDs across FETCH/SYNTH/HARN/FRESH/DOC with traceability to plans 24-01..04
- `.planning/ROADMAP.md` §Phase 24 — goal, success criteria (5), plan breakdown (4)

### Existing engine surfaces the pipeline hooks into
- `src/episodic/consolidate.ts` — `runConsolidate(date)` is invoked by Plan 24-03 (D-04)
- `src/episodic/sources.ts` — `getPensieveEntriesForDay()` with M008.1 `source='telegram'` filter (fixtures must align)
- `src/decisions/resolution.ts` — `handleResolution` invoked by Plan 24-02 when synthesizing resolved decisions (SYNTH-04)
- `src/db/schema.ts` — Drizzle schema; authoritative column types for fetch-prod-data JSONL emission
- `src/db/connection.ts` — postgres.js client setup precedent
- `src/llm/client.ts` — Anthropic SDK singleton; VCR wrapper (D-03) layers on top
- `src/llm/prompts.ts` — constitutional preamble used in consolidation
- `@anthropic-ai/sdk/helpers/zod` `zodOutputFormat` — typed output pattern

### Existing script precedents
- `scripts/backfill-episodic.ts` — day-by-day consolidation invocation pattern; Luxon DST-safe date iteration; continue-on-error + 2s rate-limit; ESM `main()` guard
- `scripts/regen-snapshots.sh` — throwaway Docker Postgres port 5434 pattern used by D-04

### Test harness precedents
- `src/__tests__/fixtures/chat-ids.ts` — chat-id registry; Plan 24-04 may add a FIXTURE_LOAD_CHAT_ID entry if needed
- `src/episodic/__tests__/synthetic-fixture.test.ts` — 14-day fixture pattern; loadPrimedFixture sanity test (HARN-03) follows similar shape
- `src/decisions/__tests__/synthetic-fixture.test.ts` — same pattern for decisions
- `vitest.config.ts` — `fileParallelism: false` (HARN-03 inherits)
- `scripts/test.sh` — 5-file excluded-suite mitigation; Plan 24-04's new sanity test should NOT be excluded (it's non-live and fast)

### Codebase map (context)
- `.planning/codebase/ARCHITECTURE.md` — 3 crons + chat engine; Plan 24-03 respects the engine layering
- `.planning/codebase/CONVENTIONS.md` — ESM `.js` suffix, pino logger, ChrisError, DST-safe Luxon, fire-and-forget; all four scripts follow
- `.planning/codebase/TESTING.md` — will be updated by Plan 24-04 (DOC-01)
- `.planning/codebase/CONCERNS.md` — §1 bulk-sync overflow TD-BULK-SYNC-01 is the forcing function for v2.3

### Key decisions in force
- PROJECT.md §Key Decisions — D004 (append-only Pensieve, so fetch scripts are read-only), D016 (build+test locally), D018 (no skipped tests — primed fixtures replace calendar waits), D019 (explicit prod approval — fetch is read-only, no approval needed), D034..D039 (M008 episodic decisions that v2.3 preserves)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`scripts/backfill-episodic.ts`** — Day-by-day consolidation invocation with Luxon DST-safe dates + ESM `main()` guard + continue-on-error + rate limit. Plan 24-03's episodic pass is structurally similar.
- **`scripts/regen-snapshots.sh`** — Throwaway Docker Postgres port 5434 pattern. Plan 24-03 reuses this container-lifecycle approach for isolated synthesis.
- **`src/db/connection.ts` + `src/db/schema.ts`** — Drizzle schema covers every table fetch-prod-data.ts needs to dump; no schema discovery required.
- **`src/episodic/consolidate.ts`** — `runConsolidate(date)` is the exact surface Plan 24-03 invokes (D-04).
- **`src/decisions/resolution.ts`** — `handleResolution` invoked by Plan 24-02 for resolved-decision synthesis.
- **`@anthropic-ai/sdk/helpers/zod` `zodOutputFormat`** — Pattern already used by `consolidate.ts`; Plan 24-02's Haiku style-transfer uses the same surface.
- **`src/episodic/__tests__/synthetic-fixture.test.ts` (1136 lines)** — Closest analog for HARN-03 sanity test; has FK-safe cleanup + `vi.setSystemTime` + source-scoped seeds.

### Established Patterns
- **ESM `.js` suffix in imports** — all new files (`fetch-prod-data.ts`, `synthesize-delta.ts`, `load-primed.ts`, `regenerate-primed.ts`, `freshness.ts`) import from sibling modules with `.js` suffix.
- **pino structured logger** at `src/utils/logger.ts` with `{ctx}, 'subsystem.event'` pattern — scripts use this, never `console.log`.
- **ChrisError typed hierarchy** — fetch/synth failures wrap raw errors in ChrisError subclasses before rethrow.
- **Luxon `dayBoundaryUtc`** — DST-safe day-range helper used by consolidate.ts; synthesize-delta's "follow organic" date math reuses this.
- **Source-scoped cleanup** — fixtures use distinct `source=` strings; loadPrimedFixture clears ALL rows but Plan 24-04's sanity test follows source-scoped precedent.

### Integration Points
- `tests/fixtures/` — new root directory for organic + primed fixtures + VCR cache. Gitignored.
- `scripts/` — four new files alongside existing two (backfill-episodic.ts, regen-snapshots.sh, test.sh, adversarial-*.ts, test-photo-memory.ts).
- `src/__tests__/fixtures/` — new home for `load-primed.ts` and `freshness.ts` alongside existing `chat-ids.ts` and `time.ts`.
- `.planning/codebase/TESTING.md` — updated in Plan 24-04.
- `.planning/codebase/CONVENTIONS.md` and/or `PROJECT.md` — new convention codified in Plan 24-04.
- `.gitignore` — `tests/fixtures/prod-snapshot/`, `tests/fixtures/primed/`, `tests/fixtures/.vcr/` added.

</code_context>

<specifics>
## Specific Ideas

- Fixture naming convention: `tests/fixtures/primed/<milestone>-<N>days/` where milestone is `m008`/`m009`/etc. The milestone tag is a pure label for operators — it doesn't gate fixture content, it just lets the operator keep multiple primed spans around.
- VCR cache naming: `tests/fixtures/.vcr/<sha256(prompt-input).hex>.json` (64-char filenames under one flat dir). Disk is cheap; `ls | wc -l` is fine.
- Snapshot directory naming: `tests/fixtures/prod-snapshot/2026-04-20T05-30-00Z/` (ISO8601 with colons replaced by hyphens for cross-platform compatibility).

</specifics>

<deferred>
## Deferred Ideas

- **Synthetic image pack for Immich paths** — defer until a milestone specifically exercises vision.
- **Synthetic voice transcripts** — defer until voice-upload lands.
- **Per-CI runner snapshot cache** — no CI currently; operator-local only.
- **Auto-prune old primed fixtures** — manual cleanup for now (D-discretion area; 30-day policy can be added later).
- **Strict-freshness toggle in `loadPrimedFixture`** — not needed for v2.3; add if a future milestone hard-requires fresh organic.
- **Env-var SSH key override** — operator uses existing key; add only if CI path emerges.
- **Cross-environment data migration (prod↔staging)** — no staging exists.
- **Automatic regression detection on snapshot diff** — nice-to-have observability; add when justified.

*Reviewed Todos:* None.

</deferred>

---

*Phase: 24-primed-fixture-pipeline*
*Context gathered: 2026-04-20 (auto mode — 11 decisions auto-selected as recommended defaults)*
