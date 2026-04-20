# Phase 24: Primed-Fixture Pipeline — Research

**Researched:** 2026-04-20
**Domain:** Test data infrastructure (organic prod fetch + synthetic delta + fixture loader)
**Confidence:** HIGH for all load-bearing decisions (CONTEXT.md pre-locked 11 design choices; research validates their implementability against the actual codebase + current ecosystem)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-11)

**D-01 — DB access for fetch script:** `scripts/fetch-prod-data.ts` is a Node + Drizzle script over a direct Postgres connection through an SSH port-forward. NOT shell `pg_dump`, NOT `psql \copy`, NOT `docker exec` via prod container. Mechanism: `ssh -L 15432:localhost:5432 root@192.168.1.50 -N &` background tunnel, then `postgres('postgres://chris:...@localhost:15432/chris')`. Tunnel torn down in `finally`. Output format: JSONL per table, one JSON object per line, stable `ORDER BY` primary key.

**D-02 — Haiku prompt structure:** Per-day Haiku call (NOT batch, NOT per-entry). System prompt describes Greg's voice (sampled from ≥5 random organic telegram entries as few-shot). User message asks for N synthetic entries for a specified synthetic date, in JSON array form. Zod-parsed via `@anthropic-ai/sdk/helpers/zod` `zodOutputFormat`. Determinism via `seededShuffle` on few-shot + `temperature=0` + VCR cache.

**D-03 — VCR cache layout:** `tests/fixtures/.vcr/<sha256-of-prompt-input>.json`. Single flat shared directory across all fixtures. Gitignored. Atomic write: tmp file + rename. Auto-invalidates on any prompt change because hash key is the full prompt input (system + user + tool-use schema).

**D-04 — Real-engine episodic synthesis:** Plan 24-03 runs the actual `runConsolidate(date)` from `src/episodic/consolidate.ts`. NOT a mock. NOT a re-implementation. Sonnet calls VCR-wrapped. Synthesis runs against temporary Docker Postgres on port **5434** (precedent: `scripts/regen-snapshots.sh`). Container torn down after fixture write.

**D-05 — Wellbeing schema strategy:** Feature-detect at runtime via `SELECT to_regclass('public.wellbeing_snapshots') IS NOT NULL`. If table exists, synthesize. If not, log one-line skip at `info` level and proceed. NO v2.3 migration 0006.

**D-06 — Freshness helper location:** Shared helper module `src/__tests__/fixtures/freshness.ts`. Surface: `isSnapshotStale(path, ttlHours = 24): boolean` + `autoRefreshIfStale(path, opts): Promise<string>`. `autoRefreshIfStale` respects `--no-refresh` via options param.

**D-07 — Organic→synthetic date mapping:** Synthetic days strictly FOLLOW organic span (chronological extension). Example: organic 2026-04-15..18 + `--target-days 14` → synthesize 2026-04-19..28. If `--target-days N < organic span`: 0 synth days, fused = organic truncated most-recent-first.

**D-08 — Fetch error handling:** `fetch-prod-data.ts` hard-fails with clear error if Proxmox unreachable or SSH tunnel fails. No fallback to last LATEST, no retry loops. Exit code 1. Message template: `"fetch-prod-data: unable to reach Proxmox at 192.168.1.50 (check VPN, SSH agent, or prod health). Use --no-refresh to force-use stale LATEST snapshot at <path> (last updated: <ISO>)."`

**D-09 — Test-runner integration:** `loadPrimedFixture()` does NOT auto-invoke freshness auto-refresh during test runs. Stale fixtures load but log a `warn`-level one-liner: `loadPrimedFixture('x'): organic snapshot is N hours old — consider running regenerate-primed.ts --milestone x --force`. Strictness toggle `{ strictFreshness: true }` deferred.

**D-10 — SSH auth:** Existing operator key at `~/.ssh/` (no new credentials, no env-var override in v2.3). Per FETCH-03 "no new credentials introduced."

**D-11 — FK-safe cleanup order** (strict reverse-FK):
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
  → wellbeing_snapshots (if table exists; D-05)
```

### Claude's Discretion
- Snapshot directory naming: ISO8601 compact form — research recommends `2026-04-20T14-30-00Z` (colons replaced by hyphens for cross-platform `ls` + filesystem portability); see `specifics` in CONTEXT.md.
- Few-shot sample size for Haiku style-transfer (D-02): research recommends **8 examples** per call (middle of 5–15 band) — enough variance for voice-capture without overflowing Haiku context; tunable per plan.
- Deterministic contradiction pair count (SYNTH-05): research recommends **3 pairs** as Phase 24 baseline (M009 weekly-review will revisit).
- Log-line format for D-05 feature-detection skip: `logger.info({ reason: 'wellbeing-table-absent' }, 'synth.wellbeing.skip')` — matches pino `subsystem.event[.variant]` convention.

### Deferred Ideas (OUT OF SCOPE)
- Synthetic image pack for Immich paths
- Synthetic voice transcripts
- Per-CI runner snapshot cache (no CI)
- Auto-prune old primed fixtures
- Strict-freshness toggle in `loadPrimedFixture`
- Env-var SSH key override
- Cross-environment data migration (prod↔staging)
- Automatic regression detection on snapshot diff
- PII scrubbing (single-user system)
- Synthetic sources other than `source='telegram'`
</user_constraints>

<phase_requirements>
## Phase Requirements

| REQ-ID | Description | Plan | Research Support |
|--------|-------------|------|------------------|
| FETCH-01 | `npx tsx scripts/fetch-prod-data.ts` dumps prod → timestamped snapshot, exits 0 | 24-01 | §Plan 24-01 — SSH tunnel + Drizzle dump, snapshot schema |
| FETCH-02 | JSONL for 9 tables (`pensieve_entries` restricted to `source='telegram'`, embeddings scoped, episodic, decisions trio, contradictions, proactive_state, memories) with stable ORDER BY | 24-01 | §Plan 24-01 — table enumeration, pgvector embedding extraction strategy |
| FETCH-03 | SSH to Proxmox using existing operator auth; no new creds; read-only | 24-01 | §Plan 24-01 — SSH tunnel patterns (D-10 lock) |
| FETCH-04 | `LATEST` symlink points to newest snapshot after each fetch | 24-01 | §Plan 24-01 — symlink atomic update |
| FETCH-05 | `tests/fixtures/prod-snapshot/` gitignored | 24-01 | §Plan 24-01 — .gitignore edit |
| SYNTH-01 | `synthesize-delta.ts --organic <stamp> --target-days N --seed NN --milestone <name>` | 24-02 | §Plan 24-02 — CLI arg parsing (parseArgs precedent in backfill-episodic.ts) |
| SYNTH-02 | Haiku per-day style-transfer, UTC+1/+2 timestamps, `source='telegram'` | 24-02 | §Plan 24-02 — Haiku prompt structure, Luxon tz math, seed plumbing |
| SYNTH-03 | Synthetic episodic summaries via real `runConsolidate(date)` | 24-03 | §Plan 24-03 — throwaway Postgres + VCR wrapper + ESM dynamic import |
| SYNTH-04 | Synthetic decisions with realistic `resolve_by`; real `handleResolution` if needed | 24-02 | §Plan 24-02 — deterministic decision generator; handleResolution invocation shape |
| SYNTH-05 | N pre-written adversarial contradiction pairs, `status='DETECTED'` | 24-02 | §Plan 24-02 — deterministic static fixtures |
| SYNTH-06 | Wellbeing snapshots 1–5 distribution, feature-detect M009 table | 24-02 | §Plan 24-02 — `to_regclass` runtime detection (D-05 lock) |
| SYNTH-07 | Same `--seed` + same organic base → byte-identical non-LLM; Anthropic outputs VCR-replayed | 24-02 | §Plan 24-02 — VCR wrapper, SHA-256 input hashing, atomic write |
| HARN-01 | `loadPrimedFixture(name)` loads fixture into Docker Postgres test DB | 24-04 | §Plan 24-04 — loader shape, pgvector insertion, FK order |
| HARN-02 | Clears target tables in FK-safe order; idempotent across repeated calls | 24-04 | §Plan 24-04 — D-11 reverse-FK delete; loader contract |
| HARN-03 | Sanity-check Vitest integration test under `fileParallelism: false` | 24-04 | §Plan 24-04 — test file shape, assertions per ROADMAP §SC-5 |
| FRESH-01 | 24h-stale snapshot triggers silent `fetch-prod-data.ts` invocation | 24-01 | §Plan 24-01 — freshness helper, spawn pattern |
| FRESH-02 | `--no-refresh` flag skips auto-fetch | 24-02 | §Plan 24-02 — options plumbing through `autoRefreshIfStale` |
| FRESH-03 | `regenerate-primed.ts --milestone X --force`: fetch → synthesize → VCR rebuild | 24-04 | §Plan 24-04 — wrapper script, composition of fetch + synth + VCR clear |
| DOC-01 | `TESTING.md` updated with primed-fixture pattern | 24-04 | §Plan 24-04 — doc update |
| DOC-02 | Convention in PROJECT.md / CONVENTIONS.md: no calendar-time data gates | 24-04 | §Plan 24-04 — convention codification |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

No `./CLAUDE.md` exists in the repository root. Project-level enforcement comes from `.planning/codebase/CONVENTIONS.md` + `PROJECT.md` §Key Decisions + MEMORY.md (user persistent memory). Applicable directives for Phase 24:

- **ESM `.js` suffix on every internal import** — all new files (`fetch-prod-data.ts`, `synthesize-delta.ts`, `load-primed.ts`, `regenerate-primed.ts`, `freshness.ts`, `vcr.ts`) MUST import siblings with `.js` suffix.
- **pino logger, never `console.*` in lib code** — scripts MAY use `console.log` for operator-facing UX lines (precedent: `backfill-episodic.ts:261`), but all structured logs go through `logger`.
- **ChrisError hierarchy for typed throws** — fetch/synth failure modes wrap raw errors in `ChrisError` subclasses.
- **Luxon `dayBoundaryUtc` + DST-safe math** — any new date iteration MUST use Luxon; no raw `new Date().setHours(0,...)` patterns.
- **No `vi.useFakeTimers`** — `vi.setSystemTime` only (D-02 rule; breaks postgres.js keep-alive).
- **Always run full Docker tests** (MEMORY.md `feedback_always_run_docker_tests`) — never skip integration tests.
- **Live server access is assumed** (MEMORY.md `feedback_live_server_access`) — SSH to 192.168.1.50 via `~/.ssh/id_ed25519` is configured and working; verified empirically during this research.
- **Named exports only; no `export default`** — match existing src/**.
- **D004 append-only Pensieve** — fetch scripts are read-only; synthetic layer never writes back to prod (safe: the SSH tunnel is used for SELECT only, connection string uses local port-forward).

## Research Summary

The CONTEXT.md lock is unusually thorough — all 11 gray areas have recommended defaults in force. Research focus is therefore **how to execute each locked decision correctly**, not re-derivation. Three issues surface that the planner must internalize:

1. **Two prod realities validated live:** (a) SSH to `root@192.168.1.50` from this sandbox works; `docker ps` on the live Proxmox shows `chris-chris-1` + `chris-postgres-1` healthy. (b) `pensieve_entries` on prod today has 23,992 `immich` rows vs 122 `telegram` rows — confirms the D-01 fetch-filter on `source='telegram'` is load-bearing: without it, fetch produces a ~200x bloated snapshot and a useless fixture.

2. **REQ-to-schema mismatch the planner MUST resolve:** REQUIREMENTS.md FETCH-02 and D-11 both name a `memories` table. The Drizzle schema has NO `memories` table; the M006 long-term-memory table is `relational_memory` (schema.ts:134). Plan 24-01 must dump `relational_memory`, Plan 24-04's loader must operate on `relational_memory`, and both must document the alias. This is almost certainly a naming drift in CONTEXT.md — the actual production table is `relational_memory`.

3. **Plan 24-03 has an untried execution pattern:** running `runConsolidate(date)` 10+ times against a throwaway 5434 Postgres while wrapping `anthropic.messages.parse()` through a VCR shim requires dynamic `DATABASE_URL` override (since `src/db/connection.ts` freezes the connection string at module-load). Concretely, Plan 24-03 must either (a) spawn a child `tsx` process with overridden `DATABASE_URL` per synthesis run, or (b) dynamically import consolidate.ts after mutating `process.env.DATABASE_URL` pre-import. Both require care against the Docker container lifecycle; neither has a direct in-repo precedent beyond `regen-snapshots.sh` (which uses shell-based psql, not in-process Drizzle).

**Primary recommendation:** Plan 24-02's VCR wrapper is the keystone — once `cachedAnthropicCall(input)` is correctly hashing over prompt + zodOutputFormat schema + model ID, the rest of the pipeline (Plans 24-02 and 24-03) reduces to straightforward orchestration. Build and unit-test the VCR wrapper first within Plan 24-02, then thread it through both Haiku (synth-delta) and Sonnet (runConsolidate override) call sites.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SSH tunnel to prod + read DB | Script (scripts/fetch-prod-data.ts) | Node child_process | Operator-driven, one-shot data extraction; no runtime coupling |
| JSONL snapshot emission | Script | File system | Stable-ordered serialization for diffability + git-free local cache |
| Haiku style-transfer | Script (scripts/synthesize-delta.ts) | LLM client (VCR-wrapped) | Operator-invoked synthesis; depends on VCR for reproducibility |
| Real-engine episodic synthesis | Script (scripts/synthesize-delta.ts Plan 24-03) | src/episodic/consolidate.ts (unchanged) | Production engine under test; fixture generation runs it as library code |
| Throwaway DB lifecycle | Script + Docker Compose | docker compose CLI | Isolation from developer's test DB + operator's prod; short-lived |
| VCR cache read/write | Library (tests/fixtures or shared helper) | File system + SHA-256 | Bit-reproducible LLM-dependent output; pure library surface |
| Fixture loader | Test fixture (src/__tests__/fixtures/load-primed.ts) | Drizzle (direct insert) | Called by Vitest test files; lives with other test infra |
| Freshness check | Shared helper (src/__tests__/fixtures/freshness.ts) | Node fs + stat | Used by 3 consumers (synth-delta, regenerate-primed, loader diagnostic) |
| Test assertion on fixture | Vitest integration test | Real Postgres + Drizzle | Exercises the loader's contract; runs under `scripts/test.sh` |
| Convention codification | Documentation (PROJECT.md / CONVENTIONS.md + TESTING.md) | N/A | Rule that downstream milestones read |

## Standard Stack

### Core (all already in repo — no new deps required for most plans)

| Library | Version (verified `npm view`) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `postgres` | 3.4.5 (in repo) | Postgres.js client for SSH-tunneled connection | Already the project's DB client; `src/db/connection.ts` precedent |
| `drizzle-orm` | 0.45.2 (in repo) | Schema-typed SELECT against prod tables | Reuses `src/db/schema.ts` types (D-01 rationale) |
| `@anthropic-ai/sdk` | 0.90.0 (in repo) | Haiku style-transfer + Sonnet consolidation | `anthropic.messages.parse({ output_config: { format: zodOutputFormat(...) } })` — same surface as `src/episodic/consolidate.ts:162` |
| `zod` / `zod/v4` | 3.24.0 (in repo) | Synthetic entry shape validation + `zodOutputFormat` compat | Mirrors Phase 21's v3/v4 dual-schema bridge |
| `luxon` | 3.7.2 (in repo) | UTC+1/+2 timestamp generation + DST-safe day iteration | `dayBoundaryUtc(date, tz)` + `DateTime.fromISO(..., { zone })` |
| `node:child_process` (spawn) | Node 22 built-in | Background SSH tunnel + optional `fetch-prod-data.ts` spawn from synth-delta | Built-in; no deps |
| `node:crypto` (createHash) | Node 22 built-in | SHA-256 input hashing for VCR keys | Built-in; `src/utils/content-hash.ts` is the in-repo precedent |
| `node:fs/promises` | Node 22 built-in | JSONL line-by-line append + symlink + atomic rename | Built-in; all Node-22-era scripts use promise fs |

### Potentially new (needed only if seeded shuffle chosen as library vs hand-rolled)

| Library | Version | Purpose | When to use |
|---------|---------|---------|-------------|
| `shuffle-seed` | 1.1.6 | Deterministic seeded Fisher-Yates shuffle of few-shot pool | If we don't hand-roll |
| `fast-shuffle` | 6.1.1 | Pure-function seeded shuffle alternative | Alternative |
| `pgvector` (npm pkg) | 0.2.1 | `pgvector.toSql([...])` helper for embedding insertion | Optional — can hand-format `'[n1,n2,...]'::vector` instead |

**Recommendation:** Hand-roll a 15-line seeded Fisher-Yates using a minimal Mulberry32 PRNG (see Code Examples below). It's shorter than the import, has zero dependencies, and the existing repo ethos is "match established patterns" — and the repo has no seeded-RNG precedent that points to a specific library. No npm addition recommended for Phase 24 unless the planner objects.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled SSH via `child_process.spawn('ssh', ['-L', ...])` | `tunnel-ssh` npm package | Adds a dep for a one-script-one-time-use; hand-roll is ~30 lines and matches "no needless deps" ethos |
| Hand-rolled VCR wrapper | `nock` / `@pollyjs/*` | VCR tools assume HTTP-level interception; we want SDK-level (intercepting `anthropic.messages.parse`). Hand-roll is simpler and matches `vi.mock` precedent |
| Per-row Drizzle INSERT for fixture load | `COPY FROM STDIN` | COPY is faster (~10x on 1M rows) but requires binary framing + escaping; our fixtures are ~200 pensieve entries + 10 summaries + ~5 decisions — Drizzle batch insert completes in <2s. Not worth the complexity |
| `pg_dump -Fc` + restore | Drizzle SELECT + JSONL | `pg_dump` is binary, non-diffable, loses the `source='telegram'` filter cleanly, and has no direct load path into the test DB. D-01 rejected this explicitly |

**Installation (Phase 24 adds zero npm deps if we hand-roll):**
```bash
# Nothing to install — every required library is already in package.json.
```

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  Prod (192.168.1.50)                                                          │
│    docker: chris-postgres-1 (port 5432 inside container network)              │
└─────────────────────────────┬────────────────────────────────────────────────┘
                              │ SSH -L 15432:localhost:5432
                              │ (uses ~/.ssh/id_ed25519 — D-10)
                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Operator machine                                                              │
│                                                                               │
│  scripts/fetch-prod-data.ts       ◀─────── FRESH-01 spawn ─── synthesize-delta│
│    ├─ spawn ssh -L 15432:...-N                                                │
│    ├─ postgres('postgres://...:15432/chris')                                  │
│    ├─ for each of 9 tables:                                                   │
│    │    SELECT ... WHERE source='telegram' (only pensieve_entries)            │
│    │    ORDER BY id (or summary_date, or detected_at, etc.)                   │
│    │    write JSONL line-by-line to                                           │
│    │      tests/fixtures/prod-snapshot/<ISO>/<table>.jsonl                    │
│    ├─ update LATEST symlink                                                   │
│    └─ finally: kill ssh tunnel (SIGTERM; SIGKILL after 5s)                    │
│                                                                               │
│  scripts/synthesize-delta.ts                                                  │
│    ├─ parseArgs (--organic --target-days --seed --milestone [--no-refresh])   │
│    ├─ autoRefreshIfStale(LATEST) → invoke fetch-prod-data if >24h             │
│    ├─ load organic JSONL → in-memory arrays                                   │
│    ├─ determine synthetic date range (D-07: strict chronological extension)   │
│    ├─ per synthetic day:                                                      │
│    │    seededShuffle(organic_pensieve, seed+day) → pick 8 few-shot examples  │
│    │    cachedAnthropicCall({ haiku, system, user, zodSchema })               │
│    │       ├─ sha256(JSON.stringify({model, system, user, schema_json}))      │
│    │       ├─ tests/fixtures/.vcr/<hash>.json hit → return; else call + write │
│    ├─ deterministic generators: decisions (N=5), contradictions (N=3), wellb  │
│    │    (feature-detect via to_regclass; skip gracefully if absent)           │
│    ├─ → Plan 24-03 handoff: runEpisodicSynthesis(orgDays, synthDays, seed)    │
│    └─ write fused fixture to tests/fixtures/primed/<milestone>-<N>days/       │
│                                                                               │
│  Plan 24-03: Episodic synthesis via real engine                               │
│    ├─ spawn throwaway Docker Postgres on port 5434 (precedent: regen-snap.sh) │
│    ├─ apply all 6 migrations                                                  │
│    ├─ loadFromJSONL(organic + synth_pensieve) into 5434 DB                    │
│    ├─ for each synthetic day:                                                 │
│    │    override DATABASE_URL=postgres://...:5434/chris                       │
│    │    dynamic import of runConsolidate                                      │
│    │    anthropic.messages.parse → VCR wrapper (same cache as Plan 24-02)     │
│    │    runConsolidate(new Date(synthDay)) — engine under test                │
│    ├─ SELECT * FROM episodic_summaries → JSONL export                         │
│    └─ docker compose down --volumes + cleanup port 5434                       │
│                                                                               │
│  src/__tests__/fixtures/load-primed.ts (HARN-01/02)                           │
│    loadPrimedFixture(name):                                                   │
│    ├─ FK-safe reverse delete (D-11 order)                                     │
│    ├─ bulk-insert in dependency order (parents → children)                    │
│    │    pensieve_entries (from JSONL)                                         │
│    │    pensieve_embeddings (pgvector.toSql or '[1,2,...]'::vector literal)   │
│    │    episodic_summaries (decisions, contradictions, memories, ...)         │
│    └─ log warn if organic snapshot age > 24h (D-09)                           │
│                                                                               │
│  scripts/regenerate-primed.ts (FRESH-03)                                      │
│    ├─ --force → rm -rf .vcr + invoke fetch-prod-data --force                  │
│    └─ invoke synthesize-delta (synth-delta handles --no-refresh honor)        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
scripts/
├── fetch-prod-data.ts          # NEW — Plan 24-01
├── synthesize-delta.ts         # NEW — Plans 24-02 + 24-03
├── regenerate-primed.ts        # NEW — Plan 24-04 FRESH-03
├── backfill-episodic.ts        # existing, unchanged
├── regen-snapshots.sh          # existing, unchanged
├── test.sh                     # existing, unchanged (24-04 sanity test NOT excluded)
└── adversarial-*.ts, test-photo-memory.ts  # existing, unchanged

src/__tests__/fixtures/
├── chat-ids.ts                 # existing — add CHAT_ID_FIXTURE_LOAD_TEST = BigInt(99924) if needed
├── time.ts                     # existing, unchanged
├── freshness.ts                # NEW — Plan 24-01 (D-06)
├── load-primed.ts              # NEW — Plan 24-04 (HARN-01/02)
└── vcr.ts                      # NEW — Plan 24-02 (D-03)

src/__tests__/fixtures/__tests__/
└── load-primed.test.ts         # NEW — Plan 24-04 (HARN-03 sanity test)

tests/fixtures/                 # NEW root directory — all gitignored
├── prod-snapshot/              # organic data
│   ├── 2026-04-20T14-30-00Z/
│   │   ├── pensieve_entries.jsonl
│   │   ├── pensieve_embeddings.jsonl
│   │   ├── episodic_summaries.jsonl
│   │   ├── decisions.jsonl
│   │   ├── decision_events.jsonl
│   │   ├── decision_capture_state.jsonl
│   │   ├── contradictions.jsonl
│   │   ├── proactive_state.jsonl
│   │   └── relational_memory.jsonl   # (REQ said 'memories'; actual table is relational_memory)
│   └── LATEST -> 2026-04-20T14-30-00Z
├── primed/                     # fused organic + synthetic
│   └── m008-14days/
│       ├── MANIFEST.json       # organic stamp, seed, target_days, milestone, generated_at
│       ├── pensieve_entries.jsonl
│       ├── pensieve_embeddings.jsonl
│       ├── episodic_summaries.jsonl
│       ├── decisions.jsonl
│       ├── decision_events.jsonl
│       ├── contradictions.jsonl
│       ├── proactive_state.jsonl
│       └── relational_memory.jsonl
└── .vcr/                       # Anthropic output cache
    └── <sha256>.json           # {request: {...}, response: {...}, cachedAt: iso}
```

### Pattern 1: SSH tunnel lifecycle via child_process.spawn

**What:** Background SSH tunnel using `-N` (no remote command) + `-L` (local port forward); torn down in `finally` using SIGTERM then SIGKILL fallback.

**When to use:** `scripts/fetch-prod-data.ts` only (Plan 24-01). Plan 24-03's throwaway Postgres does NOT use SSH; it's a local docker container.

**Example:**
```ts
// Source: WebSearch + Node.js docs (Node 22 ESM) — pattern assembled from
// multiple sources; no single in-repo precedent. Verified locally against
// working SSH to 192.168.1.50.
import { spawn, ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

async function openTunnel(
  localPort: number,
  remoteHost: string,
  remotePort: number,
  sshTarget: string,
): Promise<ChildProcess> {
  const ssh = spawn('ssh', [
    '-N',                                // no remote command
    '-L', `${localPort}:${remoteHost}:${remotePort}`,
    '-o', 'ExitOnForwardFailure=yes',    // fail fast if port busy
    '-o', 'ConnectTimeout=10',
    '-o', 'ServerAliveInterval=30',
    sshTarget,                            // e.g. 'root@192.168.1.50'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Poll for port readiness — SSH's -L takes ~200ms to establish
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (ssh.exitCode !== null) {
      throw new ChrisError('ssh tunnel died before ready', 'FETCH_TUNNEL_ERROR');
    }
    // Probe: try to open a TCP socket to localhost:localPort
    const ok = await probeConnect(localPort);
    if (ok) return ssh;
    await delay(200);
  }
  ssh.kill('SIGKILL');
  throw new ChrisError('ssh tunnel timeout', 'FETCH_TUNNEL_ERROR');
}

async function closeTunnel(ssh: ChildProcess): Promise<void> {
  if (ssh.exitCode !== null) return;
  ssh.kill('SIGTERM');
  // Give 2s for graceful close, then SIGKILL
  const raced = await Promise.race([
    new Promise(r => ssh.on('exit', () => r('exit'))),
    delay(2000).then(() => 'timeout'),
  ]);
  if (raced === 'timeout') ssh.kill('SIGKILL');
}
```

**Wire into main():**
```ts
let ssh: ChildProcess | null = null;
try {
  ssh = await openTunnel(15432, 'localhost', 5432, 'root@192.168.1.50');
  const client = postgres('postgres://chris:...@localhost:15432/chris');
  // ... do fetch ...
  await client.end();
} finally {
  if (ssh) await closeTunnel(ssh);
  // Also register SIGINT/SIGTERM handlers at main() top to call closeTunnel
}
```

**Pitfall source:** [SSH Tunneling in Node.js (Medium)](https://medium.com/@shtaft/ssh-tunneling-in-node-js-308008cfc5f1), [ssh2 Issue #67](https://github.com/mscdex/ssh2/issues/67).

### Pattern 2: VCR-style cache wrapper for Anthropic SDK

**What:** Wrapper around `anthropic.messages.parse(...)` and `anthropic.messages.create(...)` that hashes input → reads/writes `tests/fixtures/.vcr/<hash>.json`.

**When to use:** All Anthropic calls inside `synthesize-delta.ts` + `runConsolidate` when invoked from Plan 24-03. NOT used in production code.

**Example:**
```ts
// Source: hand-rolled per D-03. No direct in-repo precedent for VCR
// caching of LLM calls; pattern adapted from vi.mock + content-hash.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { anthropic } from '../../src/llm/client.js';

const VCR_DIR = 'tests/fixtures/.vcr';

/**
 * Hash strategy — JSON.stringify with sorted keys to avoid object-key-order
 * false-misses. The Zod schema is turned into its JSON-Schema form via
 * zodOutputFormat's underlying z.toJSONSchema() before hashing; this is the
 * same transformation the SDK does so hash stability tracks the on-wire shape.
 */
function canonicalStringify(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

function hashRequest(request: Record<string, unknown>): string {
  // For output_config.format (zodOutputFormat), extract the JSON-Schema form
  // so we hash over the wire representation, not the Zod object identity.
  const normalized = normalizeRequest(request);
  return createHash('sha256')
    .update(canonicalStringify(normalized))
    .digest('hex');
}

export async function cachedMessagesParse<T>(
  request: Parameters<typeof anthropic.messages.parse>[0],
): Promise<Awaited<ReturnType<typeof anthropic.messages.parse>>> {
  const hash = hashRequest(request as Record<string, unknown>);
  const cachePath = join(VCR_DIR, `${hash}.json`);
  try {
    const hit = await readFile(cachePath, 'utf8');
    logger.info({ hash: hash.slice(0, 8) }, 'vcr.hit');
    return JSON.parse(hit);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  // Miss path
  logger.info({ hash: hash.slice(0, 8) }, 'vcr.miss');
  const response = await anthropic.messages.parse(request);
  await mkdir(VCR_DIR, { recursive: true });
  // Atomic write: tmp + rename (D-03)
  const tmpPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(response, null, 2), 'utf8');
  await rename(tmpPath, cachePath);
  return response;
}
```

**Key insight:** Plan 24-03's real-engine synthesis needs this wrapper applied to `src/episodic/consolidate.ts`'s `anthropic.messages.parse(...)` call. Since `consolidate.ts` imports `anthropic` from `src/llm/client.js`, the override strategy is the Vitest `vi.mock('../../llm/client.js', ...)` pattern — except here we're NOT in a test file, we're in a script. Two options for the planner:

1. **Child-process route** — Plan 24-03 spawns `tsx -e "import('./src/episodic/consolidate.js').then(...)"` with `DATABASE_URL` and a `VCR_ENABLED=1` env flag. `src/llm/client.ts` is edited to check the env flag and swap in the VCR wrapper at module-load time. **Drawback:** modifies production code.
2. **In-process import-hook route** — Plan 24-03 uses a `vcr-anthropic-shim.ts` that monkey-patches `anthropic.messages.parse` *before* dynamically importing `../src/episodic/consolidate.js`. ESM import caching means this works only on first import. **Drawback:** subtle; monkey-patching the singleton.
3. **Recommended:** Plan 24-03 introduces a new `runConsolidateWithVCR` in a sibling module that composes all the pieces of `runConsolidate` but routes the `anthropic.messages.parse` call through the VCR wrapper. This is a ~60 line file that imports `assembleConsolidationPrompt`, `getPensieveEntriesForDay`, `getContradictionsForDay`, `getDecisionsForDay` from `src/episodic/`, and calls the VCR wrapper. **Trade-off:** small code duplication with `consolidate.ts`. **Upside:** zero production code modification, pure script-layer composition.

### Pattern 3: JSONL streaming write with stable ORDER BY

**What:** Stream rows from Drizzle SELECT into a newline-delimited JSON file without buffering the entire result set in memory.

**When to use:** `fetch-prod-data.ts` per-table dump. `pensieve_embeddings` could grow to 100k+ rows (122 telegram × N chunks + future voice/doc sources).

**Example:**
```ts
// Source: hand-rolled. Drizzle doesn't expose streaming; postgres.js does.
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

async function dumpTable<T>(
  client: postgres.Sql,
  tableName: string,
  orderByCol: string,
  filter?: string, // e.g. "source='telegram'"
  outPath: string,
): Promise<number> {
  const where = filter ? `WHERE ${filter}` : '';
  const q = `SELECT * FROM ${tableName} ${where} ORDER BY ${orderByCol}`;

  const out = createWriteStream(outPath, { encoding: 'utf8' });
  let count = 0;
  // postgres.js supports cursor-based iteration via .cursor(rowsPerFetch)
  for await (const chunk of client.unsafe(q).cursor(1000)) {
    for (const row of chunk) {
      // Convert vector columns (pensieve_embeddings.embedding) from numeric[]
      // to compact JSON array representation. bigint -> string for JSON.
      out.write(JSON.stringify(row, bigintReplacer) + '\n');
      count++;
    }
  }
  out.end();
  return count;
}
```

**Embedding serialization gotcha:** postgres.js returns pgvector columns as a parsed JS array (e.g. `[0.123, -0.456, ...]`) by default. On round-trip to JSONL this is fine — `JSON.stringify` produces `[0.123,-0.456,...]`, and on load Plan 24-04 can convert to pgvector literal `'[${arr.join(',')}]'::vector` for bulk INSERT.

### Pattern 4: Seeded deterministic shuffle (hand-rolled)

**What:** 15-line Mulberry32 + Fisher-Yates for deterministic few-shot sampling.

**When to use:** Plan 24-02's `seededShuffle(organicEntries, seed+dayIndex)`.

**Example:**
```ts
// Source: hand-rolled. Mulberry32 is a standard 32-bit seeded PRNG
// (public-domain algorithm by Tommy Ettinger / Boyer; used throughout
// game dev and test fixture libraries). Deterministic across Node
// versions since it uses only 32-bit unsigned int arithmetic.
function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const rng = mulberry32(seed >>> 0);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i]!, out[j]!] = [out[j]!, out[i]!];
  }
  return out;
}

export function seededSample<T>(arr: readonly T[], n: number, seed: number): T[] {
  return seededShuffle(arr, seed).slice(0, n);
}
```

**Alternative:** `shuffle-seed@1.1.6` (MIT, deps: `seedrandom@2.4.2`). If the planner prefers zero hand-rolled PRNG code, install this. For Phase 24 I recommend hand-roll.

### Pattern 5: `to_regclass` feature detection for D-05 wellbeing

**What:** SQL-level check that avoids throwing when a table doesn't exist.

**When to use:** Plan 24-02 wellbeing synth step.

**Example:**
```ts
// Source: PostgreSQL docs. to_regclass returns NULL (vs. throwing) when
// object missing — makes it the correct feature-detect for optional tables.
const result = await db.execute(
  sql`SELECT to_regclass('public.wellbeing_snapshots') AS exists`
);
const wellbeingExists = result[0]?.exists !== null;
if (!wellbeingExists) {
  logger.info({ reason: 'wellbeing-table-absent' }, 'synth.wellbeing.skip');
  return;
}
// ... proceed to synthesize wellbeing rows
```

### Pattern 6: Throwaway Postgres on port 5434 (extension of regen-snapshots.sh)

**What:** Spin up isolated container, apply migrations, use, tear down.

**When to use:** Plan 24-03 (synthesis), Plan 24-04 sanity test if it needs a 2nd isolated DB (unlikely — sanity test runs inside `scripts/test.sh`'s existing Docker Postgres on 5433).

**Example (abbreviated — full pattern in `scripts/regen-snapshots.sh:63-75`):**
```bash
COMPOSE_PROJECT="chris-synth"  # distinct from chris-local (5433) and chris-regen (5434)
OVERRIDE="${TMP_DIR}/docker-compose.synth.override.yml"
cat > "$OVERRIDE" <<OVR
services:
  postgres:
    ports:
      - "5434:5432"
OVR
# Note: chris-regen also uses 5434 — coordinate port or use 5435 for synth
```

**Port collision warning:** `regen-snapshots.sh` already uses 5434. If the operator runs `scripts/regen-snapshots.sh` in parallel with Plan 24-03 synthesis, they'll collide. **Recommendation:** Plan 24-03 uses **port 5435** (or parameterize). The planner should call this out in task-level verification.

### Anti-Patterns to Avoid

- **Mocking `runConsolidate` for Plan 24-03.** D-04 explicitly forbids this; the whole point is that the engine under test produces the fixture. Any PR that introduces `vi.mock('../src/episodic/consolidate.js', ...)` in synthesize-delta.ts violates D-04.
- **Per-entry Haiku calls.** D-02 forbids this. Cost + determinism hit.
- **Batch-across-days Haiku call.** D-02 also forbids this.
- **Using UTC-only timestamps for synthetic pensieve entries.** SYNTH-02 says "realistic UTC+1/+2 per season." Entries must carry `createdAt` that, when rendered via Luxon `.setZone('Europe/Paris')`, gives plausible wall-clock hours for Greg (not all entries at 00:00:00 UTC).
- **Writing to prod Postgres from any new script.** D004 append-only contract. The SSH tunnel + `postgres('...localhost:15432...')` client MUST only issue SELECT. Consider setting `default_transaction_read_only = on` at the session level for belt-and-suspenders.
- **Deleting `tests/fixtures/.vcr/` between tests.** The cache is the source of determinism. `.gitignore` entry, `rm -rf` only on `--force` or manual intervention.
- **Inlining the 24h staleness check in three places.** D-06 — shared helper is load-bearing for DRY + future tunability.
- **Re-enabling Vitest parallelism.** `fileParallelism: false` is load-bearing per TESTING.md `D-02`. Plan 24-04's sanity test must not regress this.
- **Extending the excluded-suite list with Plan 24-04's sanity test.** Sanity test is non-live (VCR-replayed or seeded mock LLM) + fast (<10s). It must run as part of `scripts/test.sh` without any `--exclude` flag.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH tunnel process-tree cleanup | Custom PID tracking + `kill` loops | `child_process.spawn` + `on('exit')` + `SIGTERM`/`SIGKILL` escalation | OS signal handling already does orphan-reaping; respecting signals is simpler and correct |
| SHA-256 hashing | Custom hash function | `node:crypto.createHash('sha256')` | Built-in, fast, correct |
| JSONL parsing on load | Manual `split('\n')` | `readline.createInterface({ input: fs.createReadStream(...) })` | Handles large files without buffering; trailing-newline semantics |
| pgvector literal construction | String concat with brackets | Drizzle's `vector` column type + postgres.js array binding (or `pgvector.toSql()`) | Single source of format truth; pgvector-node is MIT, 43KB |
| Argument parsing | Hand-rolled flag parser | `parseArgs` from `node:util` (precedent: `scripts/backfill-episodic.ts:72-87`) | Built-in, strict mode catches typos, no deps |
| Date range iteration | Manual `+= 86400000` | Luxon `DateTime.plus({ days: 1 })` (precedent: `backfill-episodic.ts:131-137`) | DST-safe |
| CLI timeout/progress UX | Custom progress bar | `process.stdout.write` single-line updates; keep it tiny for a one-shot operator script | Progress bars add deps; not needed |
| File atomicity on VCR writes | Fancy fsync | Temp file + `fs.rename` | POSIX atomic-rename is the standard primitive (D-03) |

**Key insight:** Every problem in Phase 24 has an off-the-shelf solution in Node 22 stdlib or an already-installed dep. Zero new npm adds is the correct target.

## Runtime State Inventory

Phase 24 is additive (new scripts + new test harness). It does NOT rename, refactor, or migrate any existing module. **This section is therefore SKIPPED for Phase 24** — no runtime state in production systems is affected by this work.

The one nuance worth flagging: the v2.3 fetch script will create new on-disk artifacts (`tests/fixtures/**`) but these are local-only and gitignored. No prod runtime state, no service configuration, no OS-registered state, no secrets, no build artifacts are created, modified, or referenced.

## Common Pitfalls

### Pitfall 1: `source='telegram'` filter missing from fetch script produces 23,994-row snapshot
**What goes wrong:** `fetch-prod-data.ts` does `SELECT * FROM pensieve_entries ORDER BY id` without the `source='telegram'` WHERE. Snapshot balloons to ~24MB of Immich photo metadata rows. Fixture load takes 60+ seconds, and synth-delta's few-shot sampling picks Immich metadata as "Greg's voice" few-shot, producing nonsense synthetic entries.
**Why it happens:** Verified live: prod has 23,992 `immich` rows vs 122 `telegram` rows. The filter is the entire signal-to-noise ratio of this fixture.
**How to avoid:** The `source='telegram'` WHERE MUST be in the pensieve_entries dump (FETCH-02 requirement, M008.1 context). Plan 24-01 task verification should assert `jq 'select(.source != "telegram")' < dump/pensieve_entries.jsonl | wc -l` returns 0.
**Warning signs:** Snapshot directory > 5MB; few-shot samples in .vcr cache contain "photo taken" or EXIF-style strings.

### Pitfall 2: pensieve_embeddings not scoped to telegram IDs → FK violations on load
**What goes wrong:** `pensieve_embeddings.entry_id` has a FK to `pensieve_entries.id`. If the fetch dumps only telegram-source pensieve_entries but dumps ALL embeddings, Plan 24-04's loader will fail with 23503 FK violation on embeddings that reference deleted Immich entries.
**Why it happens:** Easy to forget the join. FETCH-02 spec says "scoped to those telegram-source ids above".
**How to avoid:**
```sql
SELECT e.* FROM pensieve_embeddings e
INNER JOIN pensieve_entries p ON e.entry_id = p.id
WHERE p.source = 'telegram'
ORDER BY e.id
```
Plan 24-01 task verification: `jq '.entry_id' < dump/pensieve_embeddings.jsonl | sort -u | wc -l` must equal the distinct telegram pensieve_entries count.

### Pitfall 3: ESM `import.meta.url === file://${process.argv[1]}` guard mismatches under tsx
**What goes wrong:** The backfill-episodic.ts pattern at line 283 checks `import.meta.url === file://${process.argv[1]}`. Under tsx (dev loader) or certain Node invocations (symlink / resolved-path differences), this can evaluate false even when the script is being run directly. The script then silently does nothing.
**Why it happens:** `process.argv[1]` can be the script file OR the tsx dispatch entrypoint depending on how it's invoked.
**How to avoid:** Use the established pattern from `scripts/backfill-episodic.ts:283` exactly — it's tested and works under `npx tsx scripts/backfill-episodic.ts`. If a new script wraps it, verify with a smoke invocation.

### Pitfall 4: Vitest's module singleton means first import of llm/client.ts pins the anthropic instance
**What goes wrong:** Plan 24-03's VCR wrapper for `runConsolidate` needs to intercept `anthropic.messages.parse`. But `src/episodic/consolidate.ts` imports `anthropic` from `../llm/client.js` at module-load time. Once the module graph loads, the `anthropic` binding is the real SDK instance. Monkey-patching it post-import is subtle.
**Why it happens:** ESM modules cache on first import; the singleton pattern in `src/llm/client.ts:8-10` means the binding is fixed.
**How to avoid:** Use **Pattern 2 Option 3 (sibling module composition)** — Plan 24-03 writes a script-local `runConsolidateWithVCR` that imports the pure helpers (`assembleConsolidationPrompt`, `getPensieveEntriesForDay`, etc.) and calls the VCR wrapper directly. No production module mutation, no singleton override.

### Pitfall 5: Regen-snapshots.sh and synth-delta.ts both use port 5434 → collision
**What goes wrong:** Operator runs `bash scripts/regen-snapshots.sh` in one terminal and `npx tsx scripts/synthesize-delta.ts --organic ... --target-days 14 --seed 42 --milestone m008` in another. Both try to bind port 5434. One fails with port-already-in-use.
**Why it happens:** `regen-snapshots.sh:44` hardcodes 5434. D-04's precedent note "precedent: regen-snapshots.sh" suggested 5434 but did not lock it.
**How to avoid:** Plan 24-03 uses **port 5435** (next free) for synthesis. Document in synth-delta.ts header comment. Planner should verify in a Task-level check.

### Pitfall 6: HuggingFace `transformers` cache EACCES during Plan 24-04 sanity test
**What goes wrong:** Plan 24-04's sanity test loads fixture → queries episodic_summaries. If any downstream import path pulls in `src/pensieve/embeddings.ts` (which does `import { pipeline } from '@huggingface/transformers'`), the embedding pipeline initializes and hits the root-owned HF cache, causing EACCES → Vitest fork-IPC hang.
**Why it happens:** Pre-existing tech debt TD-BULK-SYNC-01 / vitest-fork-EACCES (CONCERNS.md §1).
**How to avoid:** Plan 24-04's sanity test MUST NOT import anything from `src/pensieve/embeddings.ts` or transitively pull it in. Asserting against `episodic_summaries` rows + `pensieve_entries` rows directly via Drizzle avoids the embedding module entirely. Mirror the pattern from `src/episodic/__tests__/synthetic-fixture.test.ts:101-108` (mocks `hybridSearch` + `getEpisodicSummary` to avoid embeddings).

### Pitfall 7: `parseArgs` strict mode vs positional args
**What goes wrong:** Plan 24-02's `synthesize-delta.ts` uses `parseArgs({ allowPositionals: false, strict: true })`. A mistyped flag like `--target-day` (missing 's') throws `UnknownOptionError`. Good! But also: `--no-refresh` requires `type: 'boolean'`, NOT `type: 'string'`.
**Why it happens:** Node's `parseArgs` infers flag type from the option definition.
**How to avoid:**
```ts
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    organic: { type: 'string' },
    'target-days': { type: 'string' }, // string then Number() — parseArgs has no int type
    seed: { type: 'string' },
    milestone: { type: 'string' },
    'no-refresh': { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
});
```

### Pitfall 8: Atomic VCR write on Windows filesystems
**What goes wrong:** `fs.rename` is atomic on POSIX but can fail with `EEXIST` on Windows if the target exists.
**Why it happens:** Windows behavior differs; the planner's local dev env is Linux (Proxmox deployer), so this is low-risk — but if a contributor is on Windows this breaks.
**How to avoid:** Use `fs.rename` — on a miss path, the target by definition doesn't exist (we just computed hash → file-not-found → wrote tmp → rename). Concurrent miss-paths from two simultaneous scripts with the same prompt are pathological; if they happen, `rename` races but both write the same bytes so eventual consistency holds.

### Pitfall 9: `proactive_state` row key name drift — restoring fixture overwrites live data
**What goes wrong:** `proactive_state` has a primary key on `key` (string). It's used by the live proactive sweep for daily-cap state. If a developer runs Plan 24-04's loader against their **local** dev DB (not the Docker test DB), it wipes out real daily-cap state.
**Why it happens:** `loadPrimedFixture` per D-11 clears ALL rows from `proactive_state`. It's a test-DB loader, but a misconfigured `DATABASE_URL` could point it at a real instance.
**How to avoid:** `loadPrimedFixture` gates on `process.env.DATABASE_URL` containing `:5433/` (the test DB port per `scripts/test.sh:7`) or a loud `FIXTURE_LOADER_ALLOW_NON_TEST_DB=1` opt-in env var. Reject with a clear error otherwise. Matches defensive patterns elsewhere in the codebase.

### Pitfall 10: `relational_memory` vs `memories` naming drift
**What goes wrong:** REQUIREMENTS.md FETCH-02 and CONTEXT.md D-11 both reference `memories`. The actual Drizzle table is `relational_memory` (`src/db/schema.ts:134`).
**Why it happens:** Drift between spec-level language ("M006 long-term memory") and schema-level identifier (`relational_memory`).
**How to avoid:** Plan 24-01 dumps `relational_memory` (the table that exists). Plan 24-04's D-11 cleanup order uses `relational_memory` in the `memories` slot. Both plans note the alias in their SUMMARY.md for future reader clarity. The planner must call this out explicitly in one task's DoD.

## Code Examples

### Example 1: Pensieve + embeddings joined dump with stable ordering

```ts
// fetch-prod-data.ts excerpt — Plan 24-01
// Source: composition of Drizzle select patterns + postgres.js cursor
import { asc, eq } from 'drizzle-orm';
import { pensieveEntries, pensieveEmbeddings } from '../src/db/schema.js';

// Option A — two queries, join by id set in memory
const entries = await db
  .select()
  .from(pensieveEntries)
  .where(eq(pensieveEntries.source, 'telegram'))
  .orderBy(asc(pensieveEntries.id));

const telegramIds = entries.map(e => e.id);
const embeddings = await db
  .select()
  .from(pensieveEmbeddings)
  .where(inArray(pensieveEmbeddings.entryId, telegramIds))
  .orderBy(asc(pensieveEmbeddings.id));

// Option B — single SELECT with JOIN
// Use Option B if telegramIds exceeds Postgres's 1664-element IN clause limit.
// For Greg's current 122 telegram entries, Option A is fine.
```

### Example 2: Realistic UTC+1/+2 timestamps for synthetic pensieve entries

```ts
// synthesize-delta.ts — Plan 24-02
// Source: Luxon setZone() pattern
import { DateTime } from 'luxon';

function synthTimestamp(
  synthDate: string,          // 'YYYY-MM-DD' in Europe/Paris
  hourLocal: number,          // 0–23 in Europe/Paris wall clock
  minute: number,
): Date {
  return DateTime.fromISO(`${synthDate}T${String(hourLocal).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00`, {
    zone: 'Europe/Paris',    // Luxon handles DST: UTC+1 in winter, UTC+2 in summer
  }).toUTC().toJSDate();
}

// Realistic hour distribution — morning (7-9), midday (12-13), evening (18-22), few late-night
const HOUR_WEIGHTS = [
  ...Array(7).fill(0),         // 00:00-06:59 rare
  2, 3, 4, 3, 2,               // 07-11 morning burst
  4, 3,                        // 12-13 lunch
  1, 1, 1, 1, 2,               // 14-18 afternoon dip
  4, 5, 5, 3, 2,               // 19-23 evening
];
```

### Example 3: Throwaway Postgres spin-up via compose override

```ts
// synthesize-delta.ts — Plan 24-03 excerpt
// Source: extension of scripts/regen-snapshots.sh pattern
import { execa } from 'child_process'; // or spawn/exec from child_process

async function spinUpSynthDb(): Promise<{ cleanup: () => Promise<void> }> {
  const projectName = `chris-synth-${process.pid}`;
  const override = join(tmpdir(), `synth-${process.pid}.yml`);
  await writeFile(override, `
services:
  postgres:
    ports: ["5435:5432"]
`);
  execSync(`docker compose -p ${projectName} -f docker-compose.local.yml -f ${override} up -d postgres`);
  await waitForReady('localhost', 5435);
  // Apply migrations (shell out to psql; pattern from test.sh + regen-snapshots.sh)
  for (const mig of MIGRATIONS) {
    execSync(`docker compose -p ${projectName} ... exec -T postgres psql -U chris -d chris -v ON_ERROR_STOP=1 < ${mig}`);
  }
  return {
    cleanup: async () => {
      execSync(`docker compose -p ${projectName} -f docker-compose.local.yml -f ${override} down --volumes --timeout 5`);
      await unlink(override);
    },
  };
}
```

### Example 4: Sanity test shape (HARN-03)

```ts
// src/__tests__/fixtures/__tests__/load-primed.test.ts — Plan 24-04
// Source: adapted from src/episodic/__tests__/synthetic-fixture.test.ts (closest analog)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import { pensieveEntries, episodicSummaries } from '../../../db/schema.js';
import { loadPrimedFixture } from '../load-primed.js';

// HARN-03 — sanity test. NOT live (no ANTHROPIC_API_KEY dependency).
// NOT excluded from scripts/test.sh (D-09). Runs in ~5s against Docker 5433.
describe('loadPrimedFixture — m008-14days sanity', () => {
  beforeAll(async () => {
    // Guard: only run if fixture directory exists. Otherwise log.skip + pass.
    // The fixture is operator-produced; CI has none.
    if (!existsSync('tests/fixtures/primed/m008-14days')) {
      console.log('sanity test: m008-14days fixture absent, skipping');
      return;
    }
    await loadPrimedFixture('m008-14days');
  });
  afterAll(async () => { await pgSql.end(); });

  it('loaded ≥ 7 episodic summaries', async () => {
    const rows = await db.select().from(episodicSummaries);
    expect(rows.length).toBeGreaterThanOrEqual(7);
  });

  it('loaded ≥ 200 pensieve entries', async () => {
    const rows = await db.select().from(pensieveEntries);
    expect(rows.length).toBeGreaterThanOrEqual(200);
  });

  it('UNIQUE(summary_date) holds', async () => {
    const rows = await db.execute(
      sql`SELECT summary_date, COUNT(*) AS c FROM episodic_summaries GROUP BY summary_date HAVING COUNT(*) > 1`
    );
    expect(rows.length).toBe(0);
  });

  it('no non-telegram source leakage', async () => {
    const rows = await db.execute(
      sql`SELECT DISTINCT source FROM pensieve_entries`
    );
    const sources = rows.map((r: any) => r.source);
    expect(sources).toContain('telegram');
    expect(sources).not.toContain('immich');
    expect(sources).not.toContain('gmail');
    expect(sources).not.toContain('drive');
  });

  it('repeated load is idempotent + collision-safe', async () => {
    await loadPrimedFixture('m008-14days'); // second call
    const rows = await db.select().from(episodicSummaries);
    expect(rows.length).toBeGreaterThanOrEqual(7);
    // No duplicate rows from two loads
  });
});
```

## Technical Approach Per Plan

### Plan 24-01 — Fetch + snapshot schema + gitignore + freshness hook

**Deliverables:**
1. `scripts/fetch-prod-data.ts`
2. `src/__tests__/fixtures/freshness.ts`
3. `.gitignore` entry for `tests/fixtures/**` (except `.gitkeep` if desired)

**Key implementation notes:**

- **SSH tunnel pattern** — `child_process.spawn('ssh', ['-N', '-L', '15432:localhost:5432', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=10', 'root@192.168.1.50'])`. Poll `net.connect(15432)` every 200ms up to 10s. Cleanup via SIGTERM → 2s → SIGKILL in `finally`.
- **Register SIGINT/SIGTERM** at top of main() so Ctrl-C kills the tunnel. Pattern:
  ```ts
  const cleanup = async () => { if (ssh) await closeTunnel(ssh); process.exit(1); };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  ```
- **Dump 9 tables** — use Drizzle `db.select().from(table).where(...).orderBy(table.id)` for each:
  1. `pensieve_entries` — WHERE `source='telegram'`, ORDER BY `id`
  2. `pensieve_embeddings` — JOIN to scope to telegram ids, ORDER BY `id`
  3. `episodic_summaries` — ORDER BY `summary_date`
  4. `decisions` — ORDER BY `id`
  5. `decision_events` — ORDER BY `sequence_no` (bigserial tiebreaker matters)
  6. `decision_capture_state` — ORDER BY `chat_id`
  7. `contradictions` — ORDER BY `id`
  8. `proactive_state` — ORDER BY `key`
  9. `relational_memory` (naming drift vs REQ's `memories` — call out in SUMMARY) — ORDER BY `id`
- **JSONL write** — `createWriteStream` per file; write `JSON.stringify(row, bigintReplacer) + '\n'` per row. `bigintReplacer` converts `bigint` columns (e.g. `sequence_no`, `chat_id`) to strings since `JSON.stringify` throws on raw bigints.
- **LATEST symlink** — after all dumps complete: `fs.symlink(relative('tests/fixtures/prod-snapshot', newDir), 'tests/fixtures/prod-snapshot/LATEST', 'dir')`. `fs.unlink` the existing LATEST first, handling ENOENT.
- **freshness.ts surface:**
  ```ts
  export function isSnapshotStale(path: string, ttlHours = 24): boolean;
  export async function autoRefreshIfStale(
    snapshotRoot: string, // e.g., 'tests/fixtures/prod-snapshot'
    opts: { noRefresh?: boolean },
  ): Promise<string>; // returns absolute path to LATEST after (optional) refresh
  ```
  Uses `fs.stat(LATEST)` on the LATEST symlink's target (not the symlink itself — `stat` follows, `lstat` doesn't; we want the target's mtime).
- **autoRefreshIfStale spawn** — when refresh needed: `child_process.spawn('npx', ['tsx', 'scripts/fetch-prod-data.ts'], { stdio: 'inherit' })`; await exit; re-read LATEST path.
- **Hard-fail on tunnel error (D-08)** — the D-08 error message template MUST be reproduced verbatim (operator muscle memory).

**Plan 24-01 testing:** Unit test `isSnapshotStale` with fake fs mtimes (this is pure; can be a unit test with no DB). Integration test of the full fetch script is operator-driven (requires SSH to prod); covered implicitly by Plan 24-04 if the operator has produced a live snapshot.

### Plan 24-02 — Synth-delta (pensieve + decisions + contradictions + wellbeing + VCR)

**Deliverables:**
1. `scripts/synthesize-delta.ts` — top-level script
2. `src/__tests__/fixtures/vcr.ts` — VCR wrapper exported for reuse (Plan 24-03 imports it)
3. Deterministic generators (inline or in `scripts/synth-generators.ts` if the planner wants to split by concern)

**Key implementation notes:**

- **Arg parsing** — `parseArgs` strict mode. See Pitfall 7 for the shape.
- **Freshness auto-refresh** — `await autoRefreshIfStale('tests/fixtures/prod-snapshot', { noRefresh: values['no-refresh'] })`. If noRefresh and LATEST missing: hard-fail.
- **Load organic JSONL** — readline.createInterface over the LATEST symlink's target. Push each line's `JSON.parse` result into per-table arrays.
- **Date range** — Luxon iterate: `let cur = DateTime.fromISO(lastOrganicDate).plus({days:1})`. Synthesize until `cur.diff(firstOrganicDate, 'days').days >= targetDays`.
- **Pensieve synth per day** — `seededShuffle(organicPensieve, seed + dayIndex).slice(0, 8)` → few-shot. Haiku call via `cachedMessagesParse` (VCR). Zod schema for output:
  ```ts
  const SynthEntryArraySchema = zV4.array(zV4.object({
    hourLocal: zV4.number().int().min(0).max(23),
    minute: zV4.number().int().min(0).max(59),
    content: zV4.string().min(1).max(2000),
    epistemicTag: zV4.enum(['FACT','EMOTION','BELIEF','INTENTION','EXPERIENCE','PREFERENCE','RELATIONSHIP','DREAM','FEAR','VALUE','CONTRADICTION','OTHER','DECISION']),
  })).min(3).max(15);
  ```
- **VCR hash** — hash over `{model, system, messages, output_config.format.schema_json}`. Cache location: `tests/fixtures/.vcr/<hash>.json`. Atomic write tmp+rename.
- **Decisions synth (SYNTH-04)** — deterministic generator: `N=5`, each with `resolve_by = synthStartDate + rng(0..14) days`, `decision_text/reasoning/prediction/falsification_criterion` from a fixed template pool indexed by `rng()`. If milestone flag triggers resolutions: synthesize a user reply (1-2 sentence seeded template) + invoke `handleResolution(chatId, replyText, decisionId)` via a script-level import. This triggers real `classifyOutcome` (Haiku → VCR-wrapped) + real `classifyAccuracy` (Haiku → VCR-wrapped) + real DB state transitions.
- **Contradictions synth (SYNTH-05)** — hardcoded N=3 pairs. Each pair writes two pensieve_entries (the two positions) + one contradictions row with `status='DETECTED'`, `entry_a_id`/`entry_b_id` referencing. Pair content: seeded but static (doesn't need Haiku). Suggested pairs:
  - Sleep: "I should go to bed earlier" vs "I work best late at night"
  - Exercise: "I need to run more" vs "Running hurts my knees"
  - Social: "I want more friend time" vs "I'm drained by groups"
- **Wellbeing synth (SYNTH-06)** — feature-detect `to_regclass('public.wellbeing_snapshots')`. If present: insert N rows with 1-5 distribution from seeded RNG. If absent: log-skip per D-05.
- **Output** — write merged organic+synth to `tests/fixtures/primed/<milestone>-<target_days>days/` with same JSONL table layout as organic snapshot.
- **MANIFEST.json** — record `{ organicStamp, seed, targetDays, milestone, generatedAt, synthDateRange: [start, end] }` at root of fixture dir. Loader (HARN-01) can read this for diagnostic.

**Plan 24-02 testing:** Unit test VCR hash stability (same input → same hash; changed schema → different hash). Unit test `seededShuffle` for determinism (same seed + input → identical output). Integration test omits — synth-delta is an operator script; its outputs are exercised by Plan 24-04's sanity test.

### Plan 24-03 — Real-engine episodic synthesis pass

**Deliverables:**
1. Sibling module `scripts/synth-episodic.ts` (or inline in synthesize-delta.ts) — runs `runConsolidate(date)` per synthetic day
2. Spin-up/tear-down of throwaway Docker Postgres on port 5435 (NOT 5434 — avoid collision with regen-snapshots.sh; see Pitfall 5)

**Key implementation notes:**

- **Throwaway DB** — `docker compose -p chris-synth-<pid> -f docker-compose.local.yml -f <override.yml> up -d postgres`. Override binds port 5435. Apply all 6 migrations (use the same psql-based pattern as `scripts/test.sh:42-55`).
- **Load fixture into 5435** — write a `scripts/load-jsonl-into-db.ts` helper that takes `{ dbUrl, snapshotDir }` → bulk inserts in FK order. This is essentially `loadPrimedFixture` but operating on an ephemeral DB, so **Plan 24-03 should build the primitive that Plan 24-04 wraps**. One option: Plan 24-04's `loadPrimedFixture` accepts a `dbOverride?: postgres.Sql` param, and Plan 24-03 passes its 5435-scoped client.
- **Per-day synthesis** — for each synthetic day `D` (Paris tz):
  - Instantiate a `postgres` client bound to 5435
  - Dynamically import `src/episodic/consolidate.ts` (with DATABASE_URL env var set to 5435 URL BEFORE import; ESM module caching means this only works on FIRST import in a given process). OR use **Pattern 2 Option 3 (sibling composition)** — safer.
  - Call `runConsolidateWithVCR(new Date(${D}T12:00:00Z))` — midday-UTC yields correct Paris-local day
  - On success: `SELECT ... FROM episodic_summaries WHERE summary_date = ${D}` → append to output JSONL
- **Sonnet VCR** — the VCR wrapper from Plan 24-02 wraps `anthropic.messages.parse` calls made during consolidation. Key: the wrapper must hash over the assembled prompt, not the prompt-input struct, because different synthetic days produce different prompts (different entries).
- **Classify-accuracy + classify-outcome VCR** — Plan 24-02 already wraps the Haiku call sites via the same VCR wrapper. If Plan 24-02 synthesizes resolved decisions, those Haiku calls are already cached.
- **Idempotency** — `runConsolidate` enforces UNIQUE(summary_date). Re-running synth-delta over the same seeded synthetic day is a safe no-op thanks to CONS-03. Validates D-04's "idempotency preserved" note.
- **Output JSONL** — after all synthetic days processed, export `episodic_summaries` from 5435 DB to the fixture dir.
- **Cleanup** — `docker compose -p chris-synth-<pid> down --volumes --timeout 5` in finally block.
- **SIGINT handler** — Plan 24-03 must clean up the 5435 container on Ctrl-C; otherwise the operator has a zombie container eating port 5435.

**Plan 24-03 testing:** No new vitest suite — the whole script is integration-flavored and operator-driven. Plan 24-04's sanity test (HARN-03) is the effective integration gate (fixture quality speaks for itself).

### Plan 24-04 — Harness loader + regenerate script + docs + convention

**Deliverables:**
1. `src/__tests__/fixtures/load-primed.ts` exporting `loadPrimedFixture(name)`
2. `scripts/regenerate-primed.ts --milestone X [--force]`
3. HARN-03 sanity test `src/__tests__/fixtures/__tests__/load-primed.test.ts`
4. Updates to `.planning/codebase/TESTING.md` + new convention line in `PROJECT.md` / `.planning/codebase/CONVENTIONS.md`

**Key implementation notes:**

- **loadPrimedFixture(name)** signature:
  ```ts
  export async function loadPrimedFixture(
    name: string,              // e.g., 'm008-14days'
    opts?: { dbOverride?: postgres.Sql }, // Plan 24-03 passes this
  ): Promise<{ loadedCounts: Record<string,number>; organicStaleHours?: number }>;
  ```
- **Safety check** — if `process.env.DATABASE_URL` doesn't contain `:5433/` AND `opts?.dbOverride` is absent AND `FIXTURE_LOADER_ALLOW_NON_TEST_DB !== '1'`: throw `ChrisError('refusing to load fixture against non-test DB ...', 'FIXTURE_UNSAFE_DB')`.
- **FK-safe delete** — per D-11, in reverse order. Use `db.delete(table).where(sql`TRUE`)` for each (no WHERE needed — full wipe per D-11 "clears ALL rows").
- **Bulk insert order** (reverse of delete): `pensieve_entries` → `pensieve_embeddings` → `decisions` → `decision_events` → `decision_capture_state` → `episodic_summaries` → `contradictions` → `proactive_state` → `relational_memory` → `conversations` → (`wellbeing_snapshots` if table exists).
- **Embedding column insert** — read JSONL line, convert `row.embedding` (parsed JS array) to `'[${nums.join(',')}]'::vector` literal via `sql.raw(...)` or use `pgvector.toSql(arr)` helper. Drizzle's `vector` column accepts arrays directly for insertion; verify with a smoke Drizzle insert of one row during implementation.
- **bigint column restore** — `conversations.chat_id`, `decisions.chat_id`, `decision_events.sequence_no` were serialized as strings; convert back via `BigInt(str)` before insert.
- **JSONB columns** — Drizzle-postgres-js bug (Drizzle issue #724, #5287) means jsonb may be inserted as a JSON-encoded string if the value is pre-stringified. Verify round-trip: insert via `{ metadata: obj }` NOT `{ metadata: JSON.stringify(obj) }`.
- **organicStaleHours** — from the fixture's MANIFEST.json → `organicStamp` → compute hours since. If > 24: `logger.warn(...)` per D-09.
- **regenerate-primed.ts shape:**
  ```bash
  npx tsx scripts/regenerate-primed.ts --milestone m008 [--force]
  ```
  - Invokes `fetch-prod-data.ts` (via spawn, inherit stdio)
  - If `--force`: also `rm -rf tests/fixtures/.vcr`
  - Invokes `synthesize-delta.ts --organic LATEST --target-days <milestone-default> --seed <milestone-default> --milestone <name>`
  - Milestone defaults table — a simple lookup: `m008 → {days: 14, seed: 42}`, `m009 → {days: 14, seed: 101}`, etc. Store in the script as a const record.
- **HARN-03 sanity test** — see Example 4 above. NOT live, NOT excluded from `scripts/test.sh`. Must run in <10s against existing test 5433 Postgres.
- **TESTING.md update** — add new section "Primed-fixture pipeline" after "Fixture Patterns". Explain the organic+synthetic model, the 3-script workflow, 24h freshness policy, `loadPrimedFixture` usage. ~30 lines.
- **New convention** — add to `.planning/codebase/CONVENTIONS.md` under a new "No calendar-time data-accumulation gates" subsection. Text:
  > **Convention (v2.3+):** No milestone may gate on real calendar time for data accumulation. Use the primed-fixture pipeline (`tests/fixtures/primed/<name>/` + `loadPrimedFixture(name)`) to produce the required volume on demand. Real-calendar-time gates hide in phrases like "after 2 weeks of real use" or "once enough summaries accumulate" — convert these into a fixture targeting the required shape.

**Plan 24-04 testing:** HARN-03 is the self-test. Add a unit test for the safety check (gates on DATABASE_URL). Add a unit test for FK-order correctness (insert M008 fixture, assert no 23503 FK violations — this lives inside HARN-03).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (`vitest` + `@vitest/coverage-v8` in devDependencies) |
| Config file | `vitest.config.ts` at repo root (`fileParallelism: false`, `root: 'src'`, `globals: false`) |
| Quick run command | `npx vitest run src/__tests__/fixtures/__tests__/load-primed.test.ts` (no Docker required for unit portion; Docker required for integration) |
| Full suite command | `bash scripts/test.sh` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FETCH-01 | Fetch produces valid snapshot + exits 0 | manual-only | `npx tsx scripts/fetch-prod-data.ts` (operator runs against live prod; SSH required) | ❌ new, Plan 24-01 |
| FETCH-02 | JSONL for 9 tables with stable ordering | unit + operator-verification | `npx vitest run scripts/__tests__/fetch-prod-data.test.ts` (mock Drizzle; test JSONL serialization + ORDER BY clauses) | ❌ Wave 0 (new script → new unit test) |
| FETCH-03 | Uses existing operator SSH auth | operator-verification | Implicit in FETCH-01 success | — |
| FETCH-04 | LATEST symlink updated | unit | `npx vitest run scripts/__tests__/fetch-prod-data.test.ts` (tmpdir test) | ❌ Wave 0 |
| FETCH-05 | .gitignore entry present | structural | `grep -q 'tests/fixtures/prod-snapshot/' .gitignore` | — structural |
| SYNTH-01 | CLI parses args | unit | `npx vitest run scripts/__tests__/synthesize-delta.test.ts` | ❌ Wave 0 |
| SYNTH-02 | Haiku per-day + UTC+1/+2 | integration-via-vcr | Same file; uses VCR cache for determinism | ❌ Wave 0 |
| SYNTH-03 | runConsolidate runs against synthetic days | integration | Implicit — HARN-03 asserts ≥ 7 summaries in the m008-14days fixture, proving runConsolidate was successfully invoked | — |
| SYNTH-04 | Decisions + resolutions | integration-via-vcr | `synthesize-delta.test.ts` | ❌ Wave 0 |
| SYNTH-05 | N contradiction pairs | unit | `synthesize-delta.test.ts` (static-generator test) | ❌ Wave 0 |
| SYNTH-06 | Wellbeing feature-detect | unit | `synthesize-delta.test.ts` (mock `to_regclass` returning null vs non-null) | ❌ Wave 0 |
| SYNTH-07 | Seed reproducibility | unit | `synthesize-delta.test.ts` (run twice → assert byte-identical non-LLM output) | ❌ Wave 0 |
| HARN-01 | loadPrimedFixture exported + callable | integration | HARN-03 sanity test | ❌ Wave 0 |
| HARN-02 | FK-safe clear + idempotent | integration | HARN-03 + unit test for safety check | ❌ Wave 0 |
| HARN-03 | Sanity test passes | integration | `bash scripts/test.sh src/__tests__/fixtures/__tests__/load-primed.test.ts` | ❌ Wave 0 |
| FRESH-01 | 24h auto-refresh | unit | `src/__tests__/fixtures/__tests__/freshness.test.ts` (fake-mtime test) | ❌ Wave 0 |
| FRESH-02 | --no-refresh honored | unit | same file | ❌ Wave 0 |
| FRESH-03 | regenerate-primed --force | integration | `scripts/__tests__/regenerate-primed.test.ts` (mock spawn of sub-scripts; assert --force clears .vcr) | ❌ Wave 0 |
| DOC-01 | TESTING.md updated | structural | `grep -q 'primed-fixture' .planning/codebase/TESTING.md` | — structural |
| DOC-02 | Convention codified | structural | `grep -q 'no milestone may gate on real calendar time' .planning/codebase/CONVENTIONS.md` | — structural |

### Sampling Rate
- **Per task commit:** `bash scripts/test.sh src/__tests__/fixtures/__tests__/` (runs ~5 fixture-related files in ~8 seconds after Docker warm-up).
- **Per wave merge:** `bash scripts/test.sh -- --exclude '**/live-integration.test.ts' --exclude '**/live-accountability.test.ts' --exclude '**/vague-validator-live.test.ts' --exclude '**/contradiction-false-positive.test.ts' --exclude '**/live-anti-flattery.test.ts'` — full suite minus 5-file excluded-suite (per TESTING.md §Excluded-Suites Mechanism). HARN-03's sanity test MUST NOT be on this exclude list.
- **Phase gate:** Full suite green (excluded-suite run) + operator smoke of `scripts/fetch-prod-data.ts` → `scripts/synthesize-delta.ts` → HARN-03 fixture present → HARN-03 green.

### Wave 0 Gaps
- [ ] `scripts/__tests__/fetch-prod-data.test.ts` — covers FETCH-02/FETCH-04 (serialization + ORDER BY; mocks SSH tunnel + Drizzle)
- [ ] `scripts/__tests__/synthesize-delta.test.ts` — covers SYNTH-01/02/04/05/06/07 (mocks Anthropic via VCR; seed reproducibility assert)
- [ ] `scripts/__tests__/regenerate-primed.test.ts` — covers FRESH-03 (mock spawn of sub-scripts; assert `--force` deletes .vcr)
- [ ] `src/__tests__/fixtures/__tests__/freshness.test.ts` — covers FRESH-01/02 (fake-mtime via `fs.utimes`; no DB required)
- [ ] `src/__tests__/fixtures/__tests__/load-primed.test.ts` — covers HARN-01/02/03 (real Postgres; loads m008-14days fixture)
- [ ] `src/__tests__/fixtures/__tests__/vcr.test.ts` — covers VCR hash stability + atomic write (pure function, no Docker needed)

**Note:** Tests that depend on a real fixture being present (HARN-03) should `describe.skipIf(!existsSync('tests/fixtures/primed/m008-14days'))` — the sanity test gracefully skips when no fixture has been produced (CI has none; only operator-invoked runs have one). This keeps `scripts/test.sh` green on a fresh clone.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Wait 7 days of real cron for M008 pause-gate" | Primed fixture on demand | v2.3 (this phase) | ~6 months of wall-clock saved over M009-M014 |
| `vi.setSystemTime` + fully-mocked pensieve seeds | Real organic + VCR-replayed synthetic | v2.3 (this phase) | Fixtures are anchored in real prod voice; engine under test produces summaries |
| Phase 18/23 synthetic-fixture patterns | Same `vi.setSystemTime` pattern, but organic as seed | v2.3 continues | HARN-03 sanity test uses vi.setSystemTime is NOT needed — fixture is time-series pre-populated |

**Deprecated/outdated for Phase 24:**
- Nothing in the existing codebase gets deprecated. Phase 24 is purely additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | [ASSUMED] Node 22's `child_process.spawn('ssh', [...], { stdio: 'ignore'... })` plus 200ms TCP-probe poll is reliable for ~10s tunnel setup across WiFi-intermittent operator networks | §Plan 24-01 | Fetch hangs in CI-less operator runs; mitigate with `ExitOnForwardFailure=yes` which I verified via SSH docs |
| A2 | [ASSUMED] `postgres.js` cursor mode (`.cursor(1000)`) streams without loading all rows into memory | §Pattern 3 | If cursor mode buffers entire result set, 100k+ pensieve_embeddings dumps could OOM — but with only 122 telegram entries today, the blast radius is small until telegram volume grows |
| A3 | [ASSUMED] `anthropic.messages.parse()` response object is fully JSON-serializable for VCR cache | §Pattern 2 | SDK may add non-JSON-serializable fields (Symbols, class instances) in future versions; mitigate by spot-checking a real response during Plan 24-02 implementation |
| A4 | [ASSUMED] Haiku at temperature=0 with identical input produces identical output within a single day and across days for the lifetime of model `claude-haiku-4-5-20251001` | §Plan 24-02 | Per WebSearch: Anthropic explicitly says temperature=0 is "near-deterministic but not guaranteed." The VCR cache closes this gap; first-run variance is acceptable; re-runs are byte-identical from cache |
| A5 | [ASSUMED] Drizzle's `vector` column type accepts both raw JS arrays and `'[n1,n2,...]'::vector` string literals on insert | §Plan 24-04 | If only string literal form works, Plan 24-04's bulk insert must convert; low-risk — easy to verify with a smoke insert during implementation |
| A6 | [ASSUMED] Postgres client from `postgres` library respects `default_transaction_read_only = on` session-level setting via `postgres('...?options=-c%20default_transaction_read_only%3Don')` | §Anti-patterns | Minor; not strictly required since the script only issues SELECTs, but belt-and-suspenders against future refactor |
| A7 | [VERIFIED: live SSH test during this research] SSH to `root@192.168.1.50` works from operator sandbox using `~/.ssh/id_ed25519` | §D-10 | Verified empirically: `ssh root@192.168.1.50 "docker ps"` returned healthy container list |
| A8 | [VERIFIED: live SQL against prod] pensieve_entries source distribution on prod is heavily Immich-skewed (23,992 immich vs 122 telegram) | §Pitfall 1 | Verified empirically via SSH+psql in this research; confirms D-01 filter is load-bearing |
| A9 | [ASSUMED] `relational_memory` is the correct table for the REQ/CONTEXT "memories" reference | §Research Summary | Verified via schema.ts inspection — the table literally named `memories` does not exist. Planner must align Plan 24-01's dump list and Plan 24-04's D-11 cleanup list to `relational_memory`; spec language was loose |
| A10 | [ASSUMED] Port 5435 is free for Plan 24-03's throwaway Postgres | §Pitfall 5 | Operator may have other containers bound; mitigation: parameterize via env var `SYNTH_DB_PORT` with default 5435 |
| A11 | [CITED: Anthropic docs via WebSearch] Prompt caching in Anthropic SDK is SDK-transparent; `cache_control: { type: 'ephemeral' }` already used in `consolidate.ts:139` — VCR wrapper must preserve this field but need not interpret it | §Pattern 2 | The VCR hash should include cache_control as part of the wire form; if Anthropic changes prompt-caching semantics, VCR cache stays stable since we're caching locally |

## Open Questions for Planner

As predicted — **none blocking**. CONTEXT.md locked all 11 gray areas. Non-blocking notes for the planner:

1. **`relational_memory` vs `memories` naming drift** — planner must pick one normalization and apply consistently across Plans 24-01 (dump name) and 24-04 (cleanup order). Recommendation: use actual table name `relational_memory` everywhere, note the REQ-level alias in both plan SUMMARY.md files.
2. **Port 5435 vs 5434** — planner should lock a specific port in Plan 24-03 task spec. Recommend 5435 (avoids collision with regen-snapshots.sh on 5434).
3. **VCR wrapper module location** — `src/__tests__/fixtures/vcr.ts` vs `scripts/vcr.ts`. Recommendation: `src/__tests__/fixtures/vcr.ts` — consistent with freshness.ts being there; also importable from `scripts/` via relative path.
4. **Plan 24-03 composition strategy** — prefer Pattern 2 Option 3 (sibling composition) over monkey-patching. Planner should name this explicitly in the plan's Task spec to avoid a contributor reaching for option 2 (in-process monkey-patch).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| SSH client (openssh) | Plan 24-01 fetch script | ✓ (verified: `ssh root@192.168.1.50` returns healthy container list) | system | — |
| Docker + docker-compose v2 | Plan 24-03 throwaway DB + Plan 24-04 Docker test gate | ✓ (existing `scripts/test.sh` relies on it) | system | — |
| Node.js 22 + tsx 4.19 | All four plans' scripts | ✓ (in devDependencies + type=module) | 22 / 4.19 | — |
| Anthropic API key (`ANTHROPIC_API_KEY` in env) | Plan 24-02 first-run + Plan 24-03 first-run | Operator-controlled | — | VCR cache — once populated, no key required |
| postgres 3.4.5 + drizzle-orm 0.45.2 | Plans 24-01 / 24-02 / 24-03 / 24-04 | ✓ (already in repo) | — | — |
| HuggingFace transformers (bge-m3 cache) | NOT directly; risk of transitive import via pensieve/embeddings | ⚠ — cache EACCES tech debt (CONCERNS.md §TD-TOOLS-01-ish) | 3.3.0 | Plan 24-04 HARN-03 test MUST NOT transitively import embeddings — see Pitfall 6 |
| `pg_isready` inside Postgres container | Plan 24-03 DB-ready poll | ✓ (in pgvector/pgvector:pg16 image) | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Anthropic API key — only required on first run (cache miss). All subsequent runs are cache-hits and require no key. Operator MUST run an initial fetch + synthesize locally with the real key set; the resulting `.vcr/` cache is then sufficient for all future Plan 24-04 sanity tests. (Note: `.vcr/` is gitignored, so each operator on each machine must do their own first-run.)

## Security Domain

`security_enforcement` not explicitly set in `.planning/config.json` — treating as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | SSH public-key auth via `~/.ssh/id_ed25519` (D-10); no new creds introduced per FETCH-03 |
| V3 Session Management | no | Script is one-shot, no sessions |
| V4 Access Control | yes | FIXTURE_LOADER safety gate — Pitfall 9. Reject if DATABASE_URL not on test port |
| V5 Input Validation | yes | parseArgs strict mode; Zod validation of Haiku synthetic output |
| V6 Cryptography | yes | SHA-256 via `node:crypto` (built-in, non-hand-rolled); OpenSSH handles transport crypto |
| V7 Error Handling & Logging | yes | ChrisError hierarchy; pino structured logs; no secrets in log output |
| V8 Data Protection | partial | Prod data flows to `tests/fixtures/` (gitignored) on operator machine. Single-user system → acceptable per spec out-of-scope note. If multi-user ever added, revisit |
| V13 API & Web Service | no | Scripts are not API-exposed |
| V14 Configuration | yes | No hardcoded credentials; SSH target parameterizable via config future-facing (deferred per D-10) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSH MitM on tunnel setup | Spoofing | Existing known_hosts entry; `ssh` options include `StrictHostKeyChecking` default (fail-on-new-host). MEMORY.md confirms known_hosts is provisioned |
| Command injection via dynamic docker-compose project name | Tampering | Use hardcoded constant or `-p chris-synth-${process.pid}` where pid is numeric — no user-controlled strings in shell commands |
| Leakage of real telegram content into git | Information Disclosure | `tests/fixtures/**` gitignored (FETCH-05). Operator-local only |
| VCR cache contains unredacted prompts (which include sampled organic content) | Information Disclosure | Same as above — gitignored. If VCR cache ever needs to leave the operator machine (e.g., sharing for debugging), redact by hash-match only |
| Tunnel left open on script crash | Elevation of Privilege (indirectly — leaves 15432 port accessible) | `finally` + SIGINT/SIGTERM handlers close tunnel; orphan-safe via spawn's parent-tracking |
| Fixture loader writes to prod DB | Tampering | FIXTURE_LOADER safety gate rejects when DATABASE_URL not on :5433 (Pitfall 9) |
| Synthetic content indistinguishable from real in tests | N/A | Not a security threat — by design. Document clearly in TESTING.md |
| pgvector injection via unsanitized embedding JSON | Injection | Use pgvector.toSql() or Drizzle parameterized binding — NOT string concat |

## Canonical References

**The planner MUST read these before decomposing Phase 24.**

### Phase-level (locked decisions + spec)
- `/home/claude/chris/.planning/phases/24-primed-fixture-pipeline/24-CONTEXT.md` — 11 locked decisions (D-01..D-11)
- `/home/claude/chris/.planning/REQUIREMENTS.md` — 20 REQ-IDs across 5 categories, full traceability table
- `/home/claude/chris/M008.5_Test_Data_Infrastructure.md` — authoritative spec
- `/home/claude/chris/.planning/ROADMAP.md` §Phase 24 — 5 success criteria + plan breakdown

### Engine surfaces the pipeline hooks into
- `/home/claude/chris/src/episodic/consolidate.ts` — `runConsolidate(date)` invoked by Plan 24-03 (D-04)
- `/home/claude/chris/src/episodic/sources.ts` — `getPensieveEntriesForDay` with `source='telegram'` filter (M008.1)
- `/home/claude/chris/src/decisions/resolution.ts` — `handleResolution` invoked by Plan 24-02 (SYNTH-04)
- `/home/claude/chris/src/db/schema.ts` — authoritative column types for fetch-prod-data JSONL emission; naming ground truth (`relational_memory` not `memories`)
- `/home/claude/chris/src/db/connection.ts` — postgres.js client setup precedent
- `/home/claude/chris/src/llm/client.ts` — Anthropic SDK singleton; VCR wrapper (D-03) composes on top without modifying this file

### Existing script precedents
- `/home/claude/chris/scripts/backfill-episodic.ts` — ESM `main()` guard, parseArgs strict mode, Luxon DST-safe date iteration, continue-on-error, 2s rate-limit (OPS-01)
- `/home/claude/chris/scripts/regen-snapshots.sh` — throwaway Docker Postgres port 5434 pattern, EXIT trap with PRODUCED flag, drizzle-kit introspect

### Test harness precedents
- `/home/claude/chris/src/__tests__/fixtures/chat-ids.ts` — CHAT_ID registry (Plan 24-04 may add `CHAT_ID_FIXTURE_LOAD_TEST`)
- `/home/claude/chris/src/episodic/__tests__/synthetic-fixture.test.ts` — 14-day fixture pattern, FK-safe cleanup, `vi.setSystemTime`, source-scoped seeds, hybridSearch mocked to avoid HuggingFace EACCES
- `/home/claude/chris/vitest.config.ts` — `fileParallelism: false`, `globals: false`, `root: 'src'`
- `/home/claude/chris/scripts/test.sh` — 6-migration apply, 5433 port, cleanup trap; HARN-03 must NOT be on the excluded-suite list

### Codebase map (reference)
- `/home/claude/chris/.planning/codebase/ARCHITECTURE.md` — layered monolith; no modifications needed
- `/home/claude/chris/.planning/codebase/CONVENTIONS.md` — ESM `.js` suffix, pino, ChrisError, DST-safe Luxon; all new code follows
- `/home/claude/chris/.planning/codebase/TESTING.md` — will be EDITED by Plan 24-04 (DOC-01)
- `/home/claude/chris/.planning/codebase/CONCERNS.md` — §TD-BULK-SYNC-01 (M008.1 filter is the barrier), §Vitest-4 fork-IPC hang (avoid transitive embeddings import)

### Verified via live operational probe during research
- SSH `ssh root@192.168.1.50 "docker ps --filter name=chris"` — returns `chris-chris-1` + `chris-postgres-1` (Up 4 hours, healthy)
- Prod pensieve_entries source distribution: 23,992 immich + 122 telegram — confirms `source='telegram'` filter is structurally essential

## Sources

### Primary (HIGH confidence)
- **Live operational verification** (this research session): SSH to 192.168.1.50, `docker ps`, `SELECT source, COUNT(*) FROM pensieve_entries`
- `src/db/schema.ts` (read) — authoritative table enumeration; confirms `relational_memory` naming
- `src/episodic/consolidate.ts` (read) — `runConsolidate` surface shape
- `src/episodic/sources.ts` (read) — `getPensieveEntriesForDay` + `dayBoundaryUtc` pattern
- `src/decisions/resolution.ts` (read) — `handleResolution` signature
- `scripts/backfill-episodic.ts` (read) — parseArgs, main() guard, Luxon iteration pattern
- `scripts/regen-snapshots.sh` (read) — throwaway Docker Postgres pattern
- `scripts/test.sh` (read) — migration application, Docker lifecycle
- `.planning/codebase/{ARCHITECTURE,CONVENTIONS,TESTING,CONCERNS}.md` — full read for project constraints
- `.planning/phases/24-primed-fixture-pipeline/24-CONTEXT.md` — 11 locked decisions

### Secondary (MEDIUM confidence)
- [Node.js ESM documentation](https://nodejs.org/api/esm.html) — `import.meta.url`, main-guard pattern
- [SSH Tunneling in Node.js (Medium)](https://medium.com/@shtaft/ssh-tunneling-in-node-js-308008cfc5f1) — child_process.spawn SSH pattern
- [mscdex/ssh2 Issue #67](https://github.com/mscdex/ssh2/issues/67) — postgres + ssh2 integration patterns
- [pgvector/pgvector-node GitHub](https://github.com/pgvector/pgvector-node) — `pgvector.toSql()` helper, bulk-insert patterns
- [Drizzle ORM Insert docs](https://orm.drizzle.team/docs/insert) — batch insert syntax
- [Anthropic docs — temperature 0 determinism](https://www.vincentschmalbach.com/does-temperature-0-guarantee-deterministic-llm-outputs/) — "near-deterministic, not guaranteed" caveat
- [fast-shuffle npm](https://www.npmjs.com/package/fast-shuffle), [shuffle-seed npm](https://www.npmjs.com/package/shuffle-seed) — seeded shuffle options
- [npm view pgvector / shuffle-seed / @anthropic-ai/sdk] — version verification (this session)

### Tertiary (LOW confidence — requires implementation-time spot verification)
- [Anthropic prompt caching behavior in SDK 0.90](https://docs.claude.com/docs/en/build-with-claude/prompt-caching) — VCR wrapper's interaction with `cache_control: ephemeral` field
- Drizzle jsonb round-trip behavior with postgres-js adapter — [Issue #724](https://github.com/drizzle-team/drizzle-orm/issues/724), [Issue #5287](https://github.com/drizzle-team/drizzle-orm/issues/5287) — must spot-verify during Plan 24-04

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in repo; npm view confirmed versions
- Architecture (SSH tunnel + VCR + throwaway DB + loader): HIGH for each individually; MEDIUM for their composition in Plan 24-03 (untried integration — composition strategy recommended but untested)
- Pitfalls: HIGH — 10 pitfalls identified, 2 verified empirically (source distribution; SSH access), rest derived from direct code reading and existing tech-debt docs

**Research date:** 2026-04-20
**Valid until:** 2026-05-20 (30 days — stack is stable; Anthropic SDK 0.90 is load-bearing and any major SDK version bump would invalidate Pattern 2)

---

## RESEARCH COMPLETE

**Phase:** 24 — Primed-Fixture Pipeline
**Confidence:** HIGH

### Key Findings

- **CONTEXT.md is fully load-bearing** — all 11 gray areas have locked decisions. Research validates each is implementable. Planner's job is decomposition, not re-derivation.
- **Prod reality empirically verified** during this research session: SSH to Proxmox (192.168.1.50) works from sandbox; prod pensieve_entries is 23,992 Immich + 122 telegram — confirms the `source='telegram'` filter in D-01/FETCH-02 is the load-bearing signal-to-noise separator.
- **Schema naming drift** the planner must reconcile: REQ/CONTEXT reference `memories` table but the Drizzle schema has `relational_memory`. Planner MUST apply the actual name consistently across Plans 24-01 and 24-04.
- **Plan 24-03 is the one with novelty** — running `runConsolidate()` against a throwaway Postgres + VCR-wrapping the Sonnet call inside has no direct in-repo precedent. Recommended approach: Pattern 2 Option 3 (sibling-module composition) avoids any production code modification. Planner should name this explicitly in the task spec.
- **Port collision risk** — `scripts/regen-snapshots.sh` uses 5434; Plan 24-03 should use 5435 to avoid collision when an operator runs both scripts.
- **Zero new npm deps required** — Mulberry32 hand-roll for seeded RNG, built-in `node:crypto` for hashing, `node:child_process` for SSH + docker lifecycle, existing postgres.js/drizzle/Luxon/Anthropic SDK already in repo.

### File Created
`/home/claude/chris/.planning/phases/24-primed-fixture-pipeline/24-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | All deps already in repo; versions verified via `npm view` |
| SSH tunnel pattern | HIGH | Verified live against prod 192.168.1.50 during research |
| VCR wrapper | MEDIUM-HIGH | Pattern assembled from multiple sources; untested composition, but well-understood primitives |
| Plan 24-03 composition | MEDIUM | Untried in-repo; sibling-module option recommended; planner should spec explicitly |
| FK-safe order + naming drift | HIGH | Directly verified against schema.ts |
| Pitfalls | HIGH | 10 pitfalls; 2 empirically verified; rest derived from direct code reading + existing CONCERNS.md tech debt |

### Open Questions

None blocking. Four non-blocking items for planner attention:
1. Lock actual table name `relational_memory` (vs REQ's `memories`) across Plans 24-01 and 24-04
2. Lock port 5435 for Plan 24-03 throwaway Postgres (avoid 5434 collision with regen-snapshots.sh)
3. Lock VCR wrapper location: `src/__tests__/fixtures/vcr.ts`
4. Lock Plan 24-03 composition strategy: sibling-module composition (NOT monkey-patch, NOT production code mod)

### Ready for Planning

Research complete. Planner has sufficient input to decompose Phase 24 into 4 plans × tasks without further input needed from user.

Sources:
- [SSH Tunneling in Node.js (Medium)](https://medium.com/@shtaft/ssh-tunneling-in-node-js-308008cfc5f1)
- [mscdex/ssh2 Issue #67 — node-postgres via SSH](https://github.com/mscdex/ssh2/issues/67)
- [pgvector/pgvector-node GitHub](https://github.com/pgvector/pgvector-node)
- [Drizzle ORM Insert docs](https://orm.drizzle.team/docs/insert)
- [Drizzle jsonb-as-string Issue #724](https://github.com/drizzle-team/drizzle-orm/issues/724)
- [Drizzle postgres-js jsonb Issue #5287](https://github.com/drizzle-team/drizzle-orm/issues/5287)
- [Temperature 0 determinism discussion](https://www.vincentschmalbach.com/does-temperature-0-guarantee-deterministic-llm-outputs/)
- [Anthropic prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [fast-shuffle npm](https://www.npmjs.com/package/fast-shuffle)
- [shuffle-seed npm](https://www.npmjs.com/package/shuffle-seed)
- [yixizhang/seed-shuffle GitHub](https://github.com/yixizhang/seed-shuffle)
- [Docker signal handling — Maxim Orlov](https://maximorlov.com/process-signals-inside-docker-containers/)
- [Node.js ESM Documentation](https://nodejs.org/api/esm.html)
- [tsx — Node TypeScript runner](https://www.npmjs.com/package/tsx/v/4.0.0)
