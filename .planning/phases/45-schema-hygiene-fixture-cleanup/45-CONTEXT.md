# Phase 45: Schema Hygiene & Fixture-Pipeline Cleanup - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** `--auto` (Claude auto-selected recommended option for every gray area; user can revise before plan-phase)

<domain>
## Phase Boundary

Root-cause the M010 `schema_mismatch` warns and clean up the heterogeneous fixture-pipeline + operator-script defects surfaced by the 14-phase v2.6.1 code-review sweep. Two thematic clusters:

- **T8 Schema hygiene (2 reqs)** — DB migrations: `0015_psychological_check_constraints` (defense-in-depth jsonb CHECKs behind Zod) + `0016_phase33_seed_defaults_backfill` (root cause of M010 `family.parent_care_responsibilities` + `health.wellbeing_trend` schema_mismatch warns). **Migration sequencing:** Phase 43 ships `0014_psychological_data_consistency_column` first (per its CONTEXT.md D-15/D-16); Phase 45 slots in at 0015 + 0016 to accommodate.
- **T7 Fixture pipeline (8 reqs)** — `synthesize-delta.ts` FK pre-filter + bias-prompt decoupling + output-dir suffix fix, `synthesize-episodic.ts` migration-list source fix, `fetch-prod-data.ts` SSH hardening, `load-primed.ts` pgvector coercion, M010 operational primed fixture refresh (downstream of SCHEMA-02), HARN word-count window alignment, and SIGINT `finally` cleanup across operator scripts.

This phase delivers **migrations + scripts + fixture refresh**. No application code paths, no Telegram surfaces, no user-visible behaviour. Read-time strict-parse failures stop occurring; operator regen runs deterministically; CI fixtures match substrate semantics.

</domain>

<decisions>
## Implementation Decisions

### Phase scoping & shipability

- **D-01:** Ship Phase 45 as a **single phase**, NOT split into 45a/45b. The two schema migrations and eight fixture-pipeline fixes belong together because (a) FIX-06 fixture refresh consumes SCHEMA-02 backfill, (b) the operator-script defects all live in the same fixture-regen surface, and (c) the milestone is already 7 phases — further fragmentation costs more in coordination than it saves in reviewability.
- **D-02:** **Internal task ordering enforced by the planner**, not by sub-phasing. Plan waves expressed as a DAG inside `45-PLAN-*.md`:
  - **Wave A (parallel, no deps):** SCHEMA-01 (migration 0015), FIX-01 (FK pre-filter), FIX-02 (bias-prompt + output-dir path bug), FIX-03 (migration list source), FIX-04 (SSH hardening), FIX-05 (vector(1024) coercion), FIX-07 (HARN window-filter), FIX-08 (SIGINT cleanup).
  - **Wave B (depends on Wave A):** SCHEMA-02 (migration 0016 backfill) — depends on SCHEMA-01 only for migration-number ordering, NOT semantically.
  - **Wave C (depends on Wave B):** FIX-06 — operator regen run + commit refreshed `tests/fixtures/primed/m010-*` artefacts against backfilled seed-defaults schema. Cannot start until 0016 has landed and `scripts/regenerate-primed.ts` has been re-run.

### Migration numbering & atomicity

- **D-03:** **Two separate migrations**, NOT one combined `0015`. Reasons: (a) atomicity per concern — a backfill failure shouldn't roll back the CHECK-constraint addition, (b) reviewability — CHECK constraint logic and seed backfill JSON are different domains, (c) future operator forensics — `git blame` on a single concern is cleaner. Drizzle's `_journal.json` already tolerates many small migrations; the project ships 14 migrations 0000..0013 (verified `ls src/db/migrations/`).
- **D-04:** Migration **`0015_psychological_check_constraints`** lands first (SCHEMA-01). Adds `CHECK ((value->>'score')::numeric BETWEEN 1.0 AND 5.0 AND (value->>'confidence')::numeric BETWEEN 0.0 AND 1.0)`-style constraints on the per-dim jsonb columns of `profile_hexaco` (HEXACO 1.0-5.0), `profile_schwartz` (0.0-7.0), and `profile_attachment` (where activated). Constraint pattern uses jsonb-path expressions per Phase 37 review WR-01 §Fix.
- **D-05:** Migration **`0016_phase33_seed_defaults_backfill`** lands second (SCHEMA-02). Two operations: (1) UPDATE the four operational profile rows where `substrate_hash = ''` so jsonb-default columns get populated with required nullable fields — e.g., `wellbeing_trend = '{"energy_30d_mean":null,"mood_30d_mean":null,"anxiety_30d_mean":null}'::jsonb`, `parent_care_responsibilities = '{"notes":null,"dependents":[]}'::jsonb`. (2) Also ALTER the column DEFAULTs on the relevant tables so future fresh DBs ship the correct seed shape. Source: Phase 34 review §Schema-Drift Origins Confirmed (lines 361-390 of `34-REVIEW.md`).

### FIX-01 — contradictions FK pre-filter semantics

- **D-06:** **Drop unmatched contradictions silently AND emit a single summary log line** (`synth.contradictions.dropped { droppedCount, totalCount }`). Rationale: (a) fail-fast would defeat the sparse-fixture path where `syntheticPensieve` is small (Phase 40 review §Tech-Debt #2 line 126), (b) silent drop with no observability would replicate the original undocumented workaround. The summary log preserves operator-visible signal without bloating per-row noise. Pre-filter applied at `scripts/synthesize-delta.ts:934` per the exact code snippet in `40-REVIEW.md:127-131`.

### FIX-02 — bias-prompt decoupling + output-dir path bug

- **D-07:** **Two separate sub-tasks under one requirement** since the review groups them under PMT-01 Tech-Debt #3:
  - **D-07a (bias prompt):** Decouple `phrasesClause` from `dimensionHint` truthiness at `scripts/synthesize-delta.ts:584-594`. Inject `phrasesClause` under its own `if (phrasesClause)` branch independent of the `dimensionHint` if-block. Per `40-REVIEW.md:135`.
  - **D-07b (output-dir path bug):** Choose **Option (b)** from `40-REVIEW.md:38-42`: update test FIXTURE_PATH constants to `m011-1000words-5days` (matching `synthesize-delta.ts:937` `${milestone}-${targetDays}days` naming). Files to update: `primed-sanity-m011.test.ts:164`, `integration-m011-1000words.test.ts:124`, plus `deferred-items.md:31-32` and `regenerate-primed.ts:304` log strings. Rationale: minimal-risk fix — synthesize-delta's naming logic is consistent and load-bearing for other call sites; renaming the constant is one-file-many-callsites whereas changing the script changes a code path used by every milestone.

### FIX-03 — migration list source

- **D-08:** **Glob `src/db/migrations/*.sql` at runtime** (not drizzle `_journal.json`). Reasons: (a) the journal file is drizzle-kit internal — its schema is versioned but the path/format isn't part of our public contract, (b) the journal lists `tag` not `filename` (`0000_curved_colonel_america` not `0000_curved_colonel_america.sql`), so consumers would still need a directory check, (c) Phase 24 review §BL-01 explicitly recommends `(await readdir('src/db/migrations')).filter(f => f.endsWith('.sql')).sort()` and this matches the test-side pattern at `scripts/test.sh:43-47`. Filter MUST exclude the `meta/` subdirectory.

### FIX-04 — SSH StrictHostKeyChecking strategy

- **D-09:** **Use `StrictHostKeyChecking=accept-new` + a vetted repo-local known_hosts file** (`scripts/.ssh-known-hosts`, committed). Rationale, weighing the three options from the task prompt:
  - **Repo-vetted known_hosts (chosen):** Reproducible across CI/operator/Proxmox-replacement-host. One-time bootstrap: operator pre-commits the Proxmox host key. Future key rotation requires an explicit repo PR — visible, auditable.
  - **Runtime `ssh-keyscan`:** Defeats the purpose — an attacker MITM-ing the first connect can also MITM the `ssh-keyscan`. Rejected.
  - **Operator's `~/.ssh/known_hosts`:** Today's behaviour; Phase 24 review §BL-03 explicitly flags this as the problem (CI/fresh-runner failure mode). Rejected.
- **D-10:** Combined options: `ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=scripts/.ssh-known-hosts ...`. `accept-new` (not `yes`) chosen so the first repo-clone-and-bootstrap still works for new operators without manual `ssh-keyscan`, but a CHANGED key on subsequent connects is rejected — closing the MITM-after-rotation window. Document the bootstrap step in the script header per Phase 24 review §BL-03 §Fix.

### FIX-05 — vector(1024) coercion approach

- **D-11:** **Pre-format JSONL embeddings as `'[1.0,2.0,...]'::vector` text strings + use staging-table cast pattern** during fixture load. Approach: in `load-primed.ts`, stage `pensieve_embeddings.jsonl` rows into a temp table where `embedding` is TEXT, then `INSERT INTO pensieve_embeddings SELECT *, embedding::vector FROM staging`. This is the pattern explicitly recommended at `24-REVIEW.md:63` §BL-06 §Fix. Rationale vs alternatives:
  - **pgvector adapter library:** Adds a dependency for one column; postgres.js's `postgres-array` already serializes vectors as JS arrays — the issue is the JSONB→VECTOR coercion path in `jsonb_populate_recordset`, not the wire format. Rejected.
  - **Raw SQL CAST (inline):** Works for INSERTs but not for `jsonb_populate_recordset` which is the current load mechanism. Would require rewriting the entire bulk-load surface — too broad a change for the requirement scope. Rejected in favour of staging-table approach which is local to the embeddings path.
- **D-12:** Smoke test added: load a single real-shaped 1024-dim embedding fixture row at the load-primed unit-test boundary so regression closes on the first non-empty regen.

### FIX-06 — operational fixture refresh

- **D-13:** **Run `npx tsx scripts/regenerate-primed.ts --milestone m010 --force`** AFTER SCHEMA-02 lands, capture the regenerated `tests/fixtures/primed/m010-*/` artefacts in a separate commit on the plan branch. The commit message must reference the SCHEMA-02 commit SHA so the regen lineage is traceable.
- **D-14:** Verify PMT-06 anti-hallucination gate passes locally before pushing — assertions in `live-anti-hallucination.test.ts` should no longer emit `family.parent_care_responsibilities` or `health.wellbeing_trend` schema_mismatch warns.

### FIX-07 — HARN calendar-month window alignment

- **D-15:** Mirror substrate semantics exactly. `totalTelegramWordCount(now)` becomes a window-filtered SQL query at `primed-sanity-m011.test.ts:89-100` using `created_at >= previousMonthStart(now, 'Europe/Paris') AND created_at <= previousMonthEnd(now, 'Europe/Paris')`, exactly matching `psychological-shared.ts:259-273`. The HARN test is driven from a pinned `NOW` constant matching each downstream integration test's `NOW`. Per `40-REVIEW.md:62-72` §BL-05 §Fix.
- **D-16:** Also fix the WR-01 strict-inequality edge case: HARN populated uses `>= MIN_SPEECH_WORDS`, sparse uses `< MIN_SPEECH_WORDS`, aligning with the substrate gate at `psychological-shared.ts:284`. Extract `MIN_SPEECH_WORDS = 5000` to a shared constant referenced from both files (eliminates magic-number duplication).

### FIX-08 — SIGINT finally cleanup

- **D-17:** Three scripts get matching treatment using **`AbortController` + `process.exitCode` pattern** (NOT `process.exit(130)` inside the signal handler). The handler sets `process.exitCode = 130` and signals an `AbortController` consumed by the in-script main loop; the existing `finally` block runs naturally as the event loop drains. Per `24-REVIEW.md:51` §BL-04 §Fix.
  - `scripts/fetch-prod-data.ts` — closes postgres client + SSH tunnel.
  - `scripts/synthesize-episodic.ts` — runs `downDocker` + closes any `dbOverride` postgres client.
  - `scripts/regenerate-primed.ts` — awaits child SIGTERM up to 5s, then SIGKILL fallback per `24-REVIEW.md:95` §WR-05 §Fix.

### Migration order rationale (canonical, NOT a separate gray area)

- **D-18:** Migration numbering enforces ordering: 0014 (Phase 43's `data_consistency` column) → 0015 (SCHEMA-01 CHECKs) → 0016 (SCHEMA-02 backfill) → FIX-06 fixture-regen. The Drizzle migrator applies migrations in lexicographic order at every `db:migrate` invocation; deploying 0015 + 0016 in one PR atomically (single `db:migrate` run) means FIX-06's regen sees both. No fancy gating needed — the migration numbering IS the gate. Documented here so the planner doesn't add redundant guards. **Cross-phase coordination:** Phase 43 takes slot `0014` for `0014_psychological_data_consistency_column` (its CONTEXT.md D-15/D-16) — Phase 45's two migrations were shifted from the originally-planned 0014/0015 to 0015/0016 to accommodate.

### Claude's Discretion

- Exact SQL CHECK-constraint expression syntax for jsonb-path operators (`(value->>'score')::numeric` vs `jsonb_extract_path_text(value, 'score')::numeric`) — planner picks whichever the existing migrations style prefers.
- Whether to extract `MIN_SPEECH_WORDS` into `src/memory/profiles/constants.ts` (new file) vs adding to existing `psychological-shared.ts` exports — planner picks based on import-graph audit.
- Repo-local `scripts/.ssh-known-hosts` filename and exact comment header (the Proxmox host key fingerprint format is determined by `ssh-keyscan` output).
- Exact log-line shape for `synth.contradictions.dropped` summary (must match the project's `pino` logger conventions; reviewer can adjust).
- Whether the staging-table approach for FIX-05 lives in `load-primed.ts` or a new `pensieve-embeddings-loader.ts` sibling module — planner judgement.
- Whether SCHEMA-02 backfill UPDATE uses `jsonb_set` per-field or one-shot `jsonb_build_object(...)` replacement — both correct; planner picks for SQL readability.

</decisions>

<specifics>
## Specific Ideas

- **"This is a cleanup phase, not a feature phase"** — every requirement traces back to a specific file:line in a Phase 24/30/34/37/40 REVIEW.md. Discretionary scope creep is explicitly disallowed by the v2.6.1 milestone charter (REQUIREMENTS.md §Out of Scope).
- **"Migration numbering IS the gate"** — D-18 captures Greg's design preference for relying on Drizzle's deterministic apply-order over runtime guards.
- **Pattern reference for SSH hardening:** The Proxmox monitor cron at `/usr/local/bin/chris-ritual-monitor.sh` already SSHes from the operator machine to 192.168.1.50 — its known_hosts pattern should be checked for symmetry with FIX-04's repo-local approach (planner audit, not blocking).
- **Pattern reference for staging-table cast:** Phase 24 review § BL-06 §Fix recommends "stage the JSONL rows into a temp table with `embedding text`, then `INSERT ... SELECT ..., embedding::vector FROM staging`" — this is the canonical approach to follow verbatim.
- **Anti-pattern to avoid:** The current `m011-1000words` test path mismatch (Phase 40 BL-01) shows what happens when the same constant lives in two places that drift. FIX-07's `MIN_SPEECH_WORDS` consolidation prevents the same drift class for the word-count gate.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (researcher + planner) MUST read these before planning or implementing.**

### Milestone synthesis & requirements

- `/home/claude/chris/.planning/PROJECT.md` — v2.6.1 milestone charter, active milestone state.
- `/home/claude/chris/.planning/REQUIREMENTS.md` §T7 FIX + §T8 SCHEMA + §Traceability table (lines 60-72, 145-154) — locked requirement IDs FIX-01..08 + SCHEMA-01..02 mapped to Phase 45.
- `/home/claude/chris/.planning/ROADMAP.md` §Phase 45 (lines 118-132) — phase goal, depends-on (none cross-phase; SCHEMA-02→FIX-06 internal), success criteria.
- `/home/claude/chris/.planning/milestones/v2.6.1-REVIEW-SYNTHESIS.md` §T7 (lines 84-91) + §T8 (lines 93-96) — root-cause synthesis for the 10 requirements.

### Per-review root causes (the meat — REQ-by-REQ)

- `/home/claude/chris/.planning/milestones/v2.3-phases/24-primed-fixture-pipeline/24-REVIEW.md`:
  - §BL-01 (lines 29-33) — FIX-03 migration list source.
  - §BL-03 (lines 41-45) — FIX-04 SSH StrictHostKeyChecking.
  - §BL-04 (lines 47-51) — FIX-08 SIGINT finally cleanup pattern.
  - §BL-06 (lines 59-63) — FIX-05 pgvector vector(1024) coercion via staging-table cast.
  - §WR-05 (lines 91-95) — FIX-08 regenerate-primed child-await pattern.
- `/home/claude/chris/.planning/milestones/v2.5-phases/34-inference-engine/34-REVIEW.md` §Schema-Drift Origins Confirmed (lines 361-390) — SCHEMA-02 backfill required jsonb keys per profile column (`energy_30d_mean`, `mood_30d_mean`, `anxiety_30d_mean`, `parent_care_responsibilities.notes`, `parent_care_responsibilities.dependents`).
- `/home/claude/chris/.planning/milestones/v2.6-phases/37-psychological-substrate/37-REVIEW.md` §WR-01 (lines 45-50) — SCHEMA-01 DB CHECK constraint syntax + range specifications (HEXACO 1.0-5.0, Schwartz 0.0-7.0, confidence 0.0-1.0).
- `/home/claude/chris/.planning/milestones/v2.6-phases/40-psychological-milestone-tests/40-REVIEW.md`:
  - §BL-01 (lines 34-42) — FIX-02 output-dir path bug.
  - §BL-05 (lines 62-72) — FIX-07 HARN calendar-month window-filter root cause + fix code.
  - §WR-01 (lines 76-79) — FIX-07 strict-inequality edge case + `MIN_SPEECH_WORDS` consolidation.
  - §Tech-Debt Root Causes #2 (lines 125-132) — FIX-01 exact pre-filter snippet at `synthesize-delta.ts:934`.
  - §Tech-Debt Root Causes #3 (lines 134-136) — FIX-02 bias-prompt `phrasesClause` decoupling root cause.

### Codebase maps (lightweight read; researcher confirms)

- `/home/claude/chris/.planning/codebase/STACK.md` §pgvector (line 51) — confirms `pgvector/pgvector:pg16` image + `vector(1024)` schema column.
- `/home/claude/chris/.planning/codebase/STACK.md` §drizzle (lines 30, 40, 50, 78) — confirms drizzle-orm 0.45.2 + drizzle-kit 0.31 + migration apply path.
- `/home/claude/chris/CLAUDE.md` — project conventions (researcher reads for SQL style + test invocation pattern).

### Source files touched (high-level, NOT exhaustive — planner refines)

- **Migrations (new):** `src/db/migrations/0015_psychological_check_constraints.sql`, `src/db/migrations/0016_phase33_seed_defaults_backfill.sql`.
- **Migration metadata:** `src/db/migrations/meta/_journal.json` (drizzle-kit auto-updates), `src/db/migrations/meta/0015_snapshot.json`, `src/db/migrations/meta/0016_snapshot.json`.
- **Scripts:** `scripts/synthesize-delta.ts` (FIX-01, FIX-02), `scripts/synthesize-episodic.ts` (FIX-03, FIX-08), `scripts/fetch-prod-data.ts` (FIX-04, FIX-08), `scripts/regenerate-primed.ts` (FIX-08).
- **Test fixtures (load surface):** `src/__tests__/fixtures/load-primed.ts` (FIX-05).
- **HARN gate:** `src/__tests__/fixtures/primed-sanity-m011.test.ts` (FIX-07).
- **Operational fixtures (regenerated, not edited):** `tests/fixtures/primed/m010-*` (FIX-06 — products of `regenerate-primed.ts`).
- **New repo-config file:** `scripts/.ssh-known-hosts` (FIX-04).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **Drizzle migration toolchain** — `npx drizzle-kit generate` produces `_snapshot.json` files + appends `_journal.json` entries automatically; the project already has 14 migrations 0000..0013 confirming the pattern. SCHEMA-01 + SCHEMA-02 use the same tooling.
- **`scripts/test.sh:43`** — `CREATE EXTENSION IF NOT EXISTS vector;` shows the test bootstrap path; FIX-05 staging-table CAST works against the same extension.
- **`load-primed.ts:219-241`** — `to_regclass` feature-detect pattern; FIX-03 wellbeing-snapshot bulk-load can mirror it.
- **`psychological-shared.ts:259-273`** — calendar-month-window SQL fragment that FIX-07 mirrors verbatim for HARN parity.
- **AbortController-driven graceful-shutdown pattern** — already used in some scheduler code; FIX-08 follows the same idiom.
- **`scripts/.env`/operator-env loading** — `PROD_PG_PASSWORD` reading pattern already established; FIX-04 does not need to change env handling, only SSH flags.

### Established Patterns

- **One file per migration, lexicographic ordering** — Drizzle applies migrations in filename order. SCHEMA-01 (0015) before SCHEMA-02 (0016) is enforced by numbering, no runtime guard needed.
- **`existsSync(MANIFEST) ? describe : describe.skip`** — Phase 44 (CI-01..03) is replacing this pattern. Phase 45's FIX-06 fixture refresh delivers fresh artefacts that Phase 44's hardened gates can then assert against. No direct dependency, but coordination note for the milestone PR sequencing.
- **`bigintReplacer` JSONL serializer at `synthesize-delta.ts:513-524`** — currently dead-code per Phase 40 review §WR-04, but the planner should NOT remove it in Phase 45 (not in scope; deferred to v2.7 backlog).
- **Drizzle `_journal.json` schema** — `entries[].when` is monotonic. New entries for 0015/0016 must have `when` values strictly greater than the latest existing entry (`when=1778699398922` from 0013 per Phase 37 review line 39); 0014 (Phase 43) lands first and bumps the latest-when.
- **Postgres.js + Drizzle node-postgres driver** — `db.execute<T>(sql\`...\`)` returns `{ rows: T[], ... }` envelope (per Phase 40 review §WR-02). FIX-07 fix should use `.rows` accessor, not array-vs-envelope branching.

### Integration Points

- **Migration apply chain:** `scripts/test.sh` (CI test DB), `src/db/connection.ts` (app startup, prod), `scripts/synthesize-episodic.ts` (throwaway DB on port 5435). FIX-03 fixes the THIRD of these; SCHEMA-02 must take effect in the second (prod) AND the third (regen throwaway).
- **Fixture regen pipeline:** `regenerate-primed.ts` → `fetch-prod-data.ts` (SSH tunnel) → `synthesize-episodic.ts` (throwaway DB) → `synthesize-delta.ts` (synth + bias) → committed `tests/fixtures/primed/<name>/`. Phase 45 touches every stage.
- **Test consumer surfaces:** `primed-sanity-m011.test.ts` (HARN), `integration-m011-*.test.ts` (PMT-03..05), `live-anti-hallucination.test.ts` (PMT-06). FIX-06 + FIX-07 land changes both sides simultaneously (fixture refresh + assertion update).
- **No app-runtime integration** — the migrations land in prod via the standard app-startup migrator. Greg's Proxmox deploy will apply 0015 + 0016 (and 0014 from Phase 43) on the next chris bot restart; no Telegram surface change.

</code_context>

<deferred>
## Deferred Ideas

Items raised during review but **explicitly out of scope** for Phase 45 (live in v2.7 backlog or other v2.6.1 phases):

- **T9 Test quality items** — calendar bomb at `live-anti-hallucination.test.ts:164`, tautological TEST-30 grounding assertion, weak `.some()` prev-state defense in `integration-m010-30days.test.ts:358-362`, lying cleanup docstring + unscoped `db.delete(wellbeingSnapshots)` in `synthetic-fixture.test.ts:184-188`. Deferred to v2.7 per REQUIREMENTS.md §Future Requirements.
- **T10 Operational hygiene** — cron-validate 6-field acceptance, scheduler reentrancy advisory-lock, poison-pill `config_invalid` slot consumption, `incrementRitualDailyCount` TOCTOU, per-ritual vs system tz mismatch, dead-code `RITUAL_JOURNAL_SUBTYPES`, `psychological-shared.ts` 669-line boundary drift, duplicate error logging at `psychological-profile-updater.ts:191`. Deferred to v2.7.
- **Phase 24 review §BL-02** — `load-primed.ts` SQL-identifier injection allowlist defense (table-name interpolation). Phase 40 review §WR-04 — `bigintReplacer` dead path. Both noted-but-not-fixed; v2.7 backlog.
- **`deterministicUuid` 32-bit entropy collision risk** (Phase 24 review §WR-07) — theoretical-today; revisit when fixtures scale beyond ~10K synthetic entries.
- **CONS-01 host-side consistency math** — depends on CONTRACT-03 (Phase 43) AND ≥3 monthly psychological-profile fires; deferred to v2.7+.
- **`MIN_SPEECH_WORDS` constant-consolidation rolling out beyond `primed-sanity-m011.test.ts`** — D-16 introduces the shared constant. Other callsites that hardcode `5000` (if any are surfaced during research) get rolled into v2.7 unless they are blocking.

</deferred>

<auto_mode_log>
## Auto-Mode Decision Log

This phase was discussed in `--auto` mode (single-pass, no AskUserQuestion). For each gray area surfaced in the task prompt, Claude selected the recommended option. The seven captured gray areas + recommendations:

1. **Phase splitability** — Recommended: single phase (D-01). Reason: dependencies + milestone fragmentation cost.
2. **SCHEMA-02 → FIX-06 internal ordering** — Recommended: enforce via migration-number sequencing + planner waves, NOT sub-phasing (D-02, D-18).
3. **Migration 0015 vs 0016 combined or separate** — Recommended: separate (D-03..D-05). Reason: atomicity + reviewability. (Original plan was 0014+0015; shifted to 0015+0016 because Phase 43 claimed slot 0014.)
4. **FIX-05 vector(1024) approach** — Recommended: pre-format JSONL + staging-table CAST (D-11). Reason: review explicitly recommends this; no new dependency.
5. **FIX-04 SSH hardening strategy** — Recommended: repo-vetted known_hosts + `StrictHostKeyChecking=accept-new` (D-09..D-10). Reason: reproducible across CI + operator; auditable rotation.
6. **FIX-03 migration list source** — Recommended: glob `src/db/migrations/*.sql` (D-08). Reason: matches existing `scripts/test.sh` pattern; doesn't depend on drizzle-kit internal journal format.
7. **FIX-01 pre-filter semantics** — Recommended: silent drop + summary log line (D-06). Reason: balances observability with sparse-fixture path correctness.

Greg should review D-01, D-09 (SSH approach), D-11 (vector cast), D-06 (FK drop semantics) before plan-phase; these are the highest-leverage decisions where his preference may differ from the auto-selection.

</auto_mode_log>

---

*Phase: 45-schema-hygiene-fixture-cleanup*
*Context gathered: 2026-05-14 (auto mode)*
*Next: `/gsd-plan-phase 45` — planner reads this CONTEXT.md + canonical_refs and produces wave-based plan files.*
