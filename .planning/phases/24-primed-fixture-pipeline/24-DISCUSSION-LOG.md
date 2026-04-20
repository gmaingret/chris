# Phase 24: Primed-Fixture Pipeline — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 24 — Primed-Fixture Pipeline
**Mode:** `--auto` (no interactive discussion; recommended defaults auto-selected)
**Areas discussed:** DB access, Haiku prompt shape, VCR layout, Engine invocation, Wellbeing schema, Freshness helper, Date mapping, Fetch error handling, Test-runner integration, SSH auth, FK-safe cleanup

---

## DB access method for fetch script

| Option | Description | Selected |
|--------|-------------|----------|
| Node + Drizzle over SSH port-forward | Reuses schema.ts types; TypeScript-native; matches ESM convention | ✓ (recommended) |
| Shell `pg_dump \| jq` | Simple but loses type info; hard to post-filter joined rows | |
| `psql \copy to JSON` | Double-quote escaping hell for multi-line pensieve entries | |
| `docker exec` inside prod container | Couples to container lifecycle; fragile | |

**Auto-selected:** Node + Drizzle over SSH port-forward.
**Notes (D-01):** `ssh -L 15432:localhost:5432` background tunnel; JSONL output with ORDER BY primary key.

---

## Haiku style-transfer prompt structure

| Option | Description | Selected |
|--------|-------------|----------|
| Per-day Haiku prompt | One call per synthetic day with N few-shot organic examples | ✓ (recommended) |
| Batch prompt (14 days at once) | Single call; cheaper but one bad day poisons all | |
| Per-entry one-to-one transfer | Most expensive; loses day-coherence | |

**Auto-selected:** Per-day Haiku prompt.
**Notes (D-02):** Matches M008 cadence; seed-controlled few-shot sampling via `seededShuffle`; `temperature=0` + VCR cache closes determinism.

---

## VCR cache layout

| Option | Description | Selected |
|--------|-------------|----------|
| Hash-keyed content-addressable | `.vcr/<sha256(prompt)>.json`; auto-invalidates on prompt change | ✓ (recommended) |
| Co-located next to fixture | Per-fixture cache; duplicates identical prompts across fixtures | |
| Shared global cache | Same as option 1 effectively but named differently | |

**Auto-selected:** Hash-keyed content-addressable.
**Notes (D-03):** Under `tests/fixtures/.vcr/`, gitignored. Atomic write (tmp + rename).

---

## Real-engine episodic synthesis (SYNTH-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Invoke real `runConsolidate(date)` | Engine under test produces fixture summaries | ✓ (recommended) |
| Mock consolidation output | Fast but creates divergence risk between test data & prod code | |
| Re-implement consolidation for fixtures | Duplicates logic; rots out of sync | |

**Auto-selected:** Invoke real `runConsolidate(date)`.
**Notes (D-04):** Sonnet calls VCR-wrapped. Synthesis runs against throwaway Docker Postgres port 5434 (precedent from `regen-snapshots.sh`).

---

## Wellbeing schema strategy (SYNTH-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Feature-detect at runtime | `to_regclass`; skip if table missing (pre-M009) | ✓ (recommended) |
| Ship v2.3 migration 0006 with the table | Premature; couples v2.3 to M009 schema decisions | |
| Defer SYNTH-06 entirely to M009 | Violates REQ SYNTH-06 which is v2.3 scope | |

**Auto-selected:** Feature-detect at runtime.
**Notes (D-05):** One-line skip logged at info level pre-M009; forward-compatible with no code change when M009 adds the table.

---

## Freshness helper location

| Option | Description | Selected |
|--------|-------------|----------|
| Shared helper `src/__tests__/fixtures/freshness.ts` | DRY across fetch/synth/regen/harness | ✓ (recommended) |
| Inline in each script's main() | Duplicates 20+ lines of logic 3× | |
| Middleware wrapper | Overengineered for 3 call sites | |

**Auto-selected:** Shared helper.
**Notes (D-06):** Surface: `isSnapshotStale(path, ttlHours=24)` + `autoRefreshIfStale(path, opts)` with `--no-refresh` support.

---

## Organic→synthetic date mapping

| Option | Description | Selected |
|--------|-------------|----------|
| Synthetic follows organic | Strict chronological extension; zero collision | ✓ (recommended) |
| Synthetic overlaps organic (gap-fill) | Creates continuous spans from sparse organic; collision risk | |
| User specifies via flag | More flexible but no clear default; decision theater | |

**Auto-selected:** Synthetic follows organic.
**Notes (D-07):** If `--target-days < organic span`, produce 0 new days and truncate to most-recent-first.

---

## Error handling for fetch-prod-data unreachable

| Option | Description | Selected |
|--------|-------------|----------|
| Hard fail with clear error | Stale data surfaces immediately to operator | ✓ (recommended) |
| Fall back to last LATEST with warning | Silent staleness defeats FRESH-01 purpose | |
| Retry with exponential backoff | Wrong abstraction — not a transient failure pattern | |

**Auto-selected:** Hard fail.
**Notes (D-08):** Exit 1 with instruction to use `--no-refresh` if stale data is intentional.

---

## Test-runner integration for freshness

| Option | Description | Selected |
|--------|-------------|----------|
| loadPrimedFixture does NOT auto-refresh | Tests hermetic; refresh at fixture-gen time | ✓ (recommended) |
| loadPrimedFixture auto-refreshes on stale | Adds network I/O to every test startup | |
| Configurable | Deferred — YAGNI for v2.3 | |

**Auto-selected:** No auto-refresh during test runs.
**Notes (D-09):** Warn log at `warn` level if stale; `{ strictFreshness: true }` option as future hook.

---

## SSH auth pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Existing operator SSH key | Per REQ FETCH-03 "no new credentials" | ✓ (recommended) |
| Env-var SSH_KEY_PATH override | Needed only if CI emerges; not yet | |
| ssh-agent only | Too rigid; breaks if agent not running | |

**Auto-selected:** Existing operator key.
**Notes (D-10):** Revisit if CI ever runs fetch-prod-data.ts.

---

## FK-safe cleanup order for loadPrimedFixture

| Option | Description | Selected |
|--------|-------------|----------|
| Strict reverse-FK order (children before parents) | Matches existing test-cleanup precedent | ✓ (recommended) |
| TRUNCATE all tables with CASCADE | Violates append-only pensieve spirit; loses audit trail | |
| Delete by source-scope | Doesn't fit full-fixture reload semantics | |

**Auto-selected:** Strict reverse-FK order.
**Notes (D-11):** Order: conversations → contradictions → pensieve_embeddings → decision_events → episodic_summaries → decision_capture_state → decisions → pensieve_entries → proactive_state → memories → wellbeing_snapshots (if exists per D-05).

---

## Claude's Discretion

- Snapshot directory naming format (ISO8601 with hyphens chosen, but compact would also be fine)
- Exact few-shot sample size for Haiku style-transfer (range 5–15; plan decides)
- Exact count of deterministic contradiction pairs for SYNTH-05 (3–5 likely)
- Log-line format for wellbeing-table feature-detection skip

## Deferred Ideas

- Synthetic image pack for Immich paths (future milestone with vision tests)
- Synthetic voice transcripts (future voice-upload milestone)
- Per-CI runner snapshot cache (no CI exists)
- Auto-prune old primed fixtures (manual cleanup for now)
- Strict-freshness toggle in `loadPrimedFixture` (YAGNI)
- Env-var SSH key override (YAGNI)
- Cross-environment data migration (no staging)
- Automatic regression detection on snapshot diff (add when justified)
