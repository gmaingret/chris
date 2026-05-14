---
phase: 24-primed-fixture-pipeline
reviewed_at: 2026-05-14
files_reviewed: 9
blocker_count: 6
warning_count: 11
---

# Phase 24 Code Review — Primed-Fixture Pipeline

Adversarial review of the 9 source files comprising Plans 24-01..04. Out-of-scope items
(performance, dead code in tests, exact wording of help text) were skipped. Findings
classified BLOCKER (must fix before next M-pipeline regen) or WARNING (should fix).

## Files reviewed

- `scripts/fetch-prod-data.ts`
- `scripts/synthesize-delta.ts`
- `scripts/synthesize-episodic.ts`
- `scripts/regenerate-primed.ts`
- `src/__tests__/fixtures/seed.ts`
- `src/__tests__/fixtures/freshness.ts`
- `src/__tests__/fixtures/vcr.ts`
- `src/__tests__/fixtures/load-primed.ts`
- `src/__tests__/fixtures/primed-sanity.test.ts`

## Blocker findings

### BL-01: synthesize-episodic.ts applies only 6 of 14 migrations against the throwaway DB
- **File:** `scripts/synthesize-episodic.ts:48-55`
- **Issue:** `MIGRATIONS` is hard-coded to `0000..0005`. The repo now ships migrations `0000..0013` (14 total) including `0006_rituals_wellbeing.sql` (creates `wellbeing_snapshots`, `rituals`, `ritual_pending_responses`), `0010_adjustment_dialogue.sql`, `0012_operational_profiles.sql`, `0013_psychological_profiles.sql`. The operator-invocation path (port 5435 throwaway container) therefore stands up a DB whose schema is months out of date. The integration test masks the bug because it injects `dbOverride` pointing at the port-5433 test DB (which `scripts/test.sh` provisions with the full migration set), so the operator path is untested in CI.
- **Impact:** `npx tsx scripts/regenerate-primed.ts --milestone m011 --force` will fail at `loadFixtureIntoDb` if any synth row references columns/tables introduced ≥ migration 0006 — or worse, will succeed silently and emit `episodic_summaries.jsonl` whose `runConsolidate` ran against a half-migrated schema, contaminating every downstream test. Synthesize-delta writes `wellbeing_snapshots.jsonl`, but synthesize-episodic doesn't import that fixture into the throwaway DB at all (no `wellbeing_snapshots` in the bulk-load list at lines 326-349) — wellbeing rows are silently dropped on every regen. The Phase 30 retroactive fix in synthesize-delta.ts:744-751 documents this exact drift.
- **Fix:** Dynamically discover migrations: `MIGRATIONS = (await readdir('src/db/migrations')).filter(f => f.endsWith('.sql')).sort()`. Also extend `loadFixtureIntoDb` to bulk-load `wellbeing_snapshots.jsonl` (and any future feature-gated tables) with `to_regclass` guard mirroring `load-primed.ts:219-241`.

### BL-02: load-primed.ts uses non-parameterized table-name interpolation in client.unsafe
- **File:** `src/__tests__/fixtures/load-primed.ts:259-262`
- **Issue:** ```await client.unsafe(`INSERT INTO ${tableName} SELECT * FROM jsonb_populate_recordset(NULL::${tableName}, $1::jsonb)`, [JSON.stringify(rows)])```. While `tableName` arguments are currently call-site constants (`'relational_memory'`, `'conversations'`, ...), the function signature accepts `string` and is not visibly defended. Worse: `client.unsafe` with placeholders is parameterized for `$1` but the table name still goes through string concatenation. Combined with the **`opts.dbOverride` accepting an arbitrary `postgres.Sql`**, and the loader being public API (HARN-01 — every future milestone calls `loadPrimedFixture(name)`), a future caller passing a fixture-derived `tableName` (e.g. parsing MANIFEST.json to drive what to load) opens a SQL-identifier injection path.
- **Impact:** Today: no exploit, but defensive-coding gap. Tomorrow: a "data-driven fixtures" feature on top of this loader is one PR away from `DROP TABLE` via crafted JSONL.
- **Fix:** Validate `tableName` against an allowlist at function entry (`if (!ALLOWED_TABLES.has(tableName)) throw`), or use a sql-identifier escaper. The Drizzle deletes don't have this gap; consolidate the bulk-insert into a switch/lookup keyed by static identifiers.

### BL-03: SSH tunnel auto-accepts unknown host keys (StrictHostKeyChecking unset)
- **File:** `scripts/fetch-prod-data.ts:73-88`
- **Issue:** The `ssh -N -L 15432:localhost:5432 ... root@192.168.1.50` invocation does not set `-o StrictHostKeyChecking=yes` or `-o UserKnownHostsFile=...`. The script will inherit the operator's `~/.ssh/known_hosts`, which is fine on the operator laptop, but in **any** less-trusted invocation (CI runner, another developer's machine, a freshly-imaged Proxmox replacement) ssh will silently accept a new host key on first connect (the default "ask" policy degrades to "accept" under non-tty `-N` mode in some configs). Combined with `-N` (no shell, no tty), the operator never sees a host-key fingerprint prompt — an attacker who can MITM the LAN gets the prod postgres password (passed via `PROD_PG_PASSWORD` env to the tunneled connection).
- **Impact:** Credential exposure to MITM on first connect or after key rotation. The script is documented as the canonical pull-from-prod mechanism (`regenerate-primed.ts` chains it on every `--force` regen) and the password environment is read at line 282 right after the tunnel opens.
- **Fix:** Add `-o StrictHostKeyChecking=accept-new` (auto-trust on first contact, refuse on mismatch) at minimum, ideally `-o StrictHostKeyChecking=yes` plus an operator-pinned `UserKnownHostsFile`. Document the bootstrap step (`ssh-keyscan 192.168.1.50 >> ~/.ssh/known_hosts`) in the script header.

### BL-04: SIGINT/SIGTERM handler skips finally — postgres client leaks
- **File:** `scripts/fetch-prod-data.ts:273-277`
- **Issue:** ```const sigHandler = (): void => { void closeTunnel(ssh).then(() => process.exit(130)); };```. The header comment (lines 314-317) explicitly calls out the bug: "process.exit() skips finally, leaking the SSH tunnel + postgres client. Use exitCode and let the event loop drain so finally runs first." Yet the signal handler still calls `process.exit(130)`, which has the exact bug they fixed for the normal exit path. On Ctrl-C the `postgres()` client (line 290) is never `.end()`-ed — the connection is left half-open until the OS reaps the process. The same pattern appears in `scripts/synthesize-episodic.ts:480-484` (the handler runs `downDocker` then `process.exit(130)` — fine for the docker container but doesn't close any in-process resources like the `dbOverride` postgres client if one were to be set up before the docker spin).
- **Impact:** Pid leakage and prod connection-slot consumption on every Ctrl-C during fetch. Documented as the original root cause for "orphan SSH tunnel pid 4145976 traced back here" (line 317 comment).
- **Fix:** In the signal handler, also call `client?.end({ timeout: 5 })` before `process.exit`, OR set `process.exitCode = 130` and let the existing `finally` run by signaling cancellation via an `AbortController` consumed by the table-dump loop. Mirror the same change in `synthesize-episodic.ts:480`.

### BL-05: synthesize-delta.ts wellbeing path connects to test DB via hard-coded fallback URL
- **File:** `scripts/synthesize-delta.ts:730-734`
- **Issue:** ```const dbUrl = process.env.DATABASE_URL ?? 'postgres://chris:localtest123@localhost:5433/chris';```. This script is invoked by `regenerate-primed.ts` which runs in the operator shell. If `DATABASE_URL` happens to be set (e.g. operator was just running `vitest`, or developer has it exported in `~/.bashrc` for app dev), the `to_regclass` probe targets THAT db — possibly **prod-via-tunnel** or a staging DB unrelated to the synth pipeline. The function then conditionally writes synthetic wellbeing rows whose schema reflects whatever DB it polled, even though the rows are written to a JSONL file that will be loaded by `synthesize-episodic.ts` into a different DB. Worse: if `DATABASE_URL` points to prod, this script is silently issuing read queries to the production DB during fixture generation, violating the "fixtures are hermetic" contract. The fallback `localhost:5433/chris` is also a **hardcoded credential** (the password `localtest123` is checked into source).
- **Impact:** Cross-DB contamination on regenerate, hardcoded test-DB password in source (a low-value secret but a project-policy violation), and a hard-fail mode if neither port-5433 nor `DATABASE_URL` is reachable (the `try` block throws and the whole synth run aborts — there's no graceful skip when the probe DB is simply unavailable). The plan claims D-05's feature-detect "skips gracefully when the table is absent" but in practice it crashes when the DB is absent.
- **Fix:** Take an explicit `--probe-db-url` flag or, better, defer wellbeing schema-shape decisions to `loadPrimedFixture` (which does its own `to_regclass` against the correct test DB). Synthesize-delta should write the wellbeing JSONL unconditionally; the loader feature-gates. Remove the hardcoded password — either fail clearly when `DATABASE_URL` is unset, or read from `docker-compose.local.yml`. Also wrap the `to_regclass` call in a connection-failure try/catch so an unreachable DB skips wellbeing synthesis rather than aborting the whole pipeline.

### BL-06: pensieve_embeddings vector column will fail jsonb_populate_recordset coercion
- **File:** `scripts/synthesize-episodic.ts:344-346`, `src/__tests__/fixtures/load-primed.ts:265-279`
- **Issue:** `pensieve_embeddings.embedding` is declared `vector(1024) NOT NULL` (schema.ts:146). The fetch script (`fetch-prod-data.ts:148`) dumps the entire row via `SELECT e.*`, where postgres.js serializes the `vector` column as a JS array (or string, depending on version). `jsonb_populate_recordset(NULL::pensieve_embeddings, ...)` then has to coerce a JSON array back into the `vector` type — this is not guaranteed to work; pgvector accepts text input like `'[1.0, 2.0, ...]'` but `jsonb_populate_recordset` will pass a `jsonb` array (not text) to the column type. In practice this produces `cannot cast type jsonb to vector` on insert. The integration test (`synthesize-episodic.test.ts`) only exercises the fixture's empty placeholder embeddings JSONL (`tiny-primed/pensieve_embeddings.jsonl` is 0 bytes), so the bug never fires in CI.
- **Impact:** First real operator regen with non-empty embeddings (any milestone after the M008.1 prod state) will hard-fail at the embeddings load step with a cryptic Postgres type-coercion error. Loader `load-primed.ts:274` has the same issue for the final fixture load.
- **Fix:** Skip the embedding column on insert and regenerate via an embedding service after load, OR cast explicitly: stage the JSONL rows into a temp table with `embedding text`, then `INSERT ... SELECT ..., embedding::vector FROM staging`. Add a smoke test that loads a fixture with one real-shaped embedding row.

## Warning findings

### WR-01: vcr.ts module-load-time SDK binding is invalidated by setVcrDirForTest race
- **File:** `src/__tests__/fixtures/vcr.ts:46-47, 53-61`
- **Issue:** `ORIGINAL_PARSE` / `ORIGINAL_CREATE` snapshot at module load. `VCR_DIR` is mutable via `setVcrDirForTest`. If test A calls `setVcrDirForTest('/tmp/A')` and test B runs in parallel under a different worker/import order, both can race on the module-level `let`. The vitest config sets `fileParallelism: false` so this is mitigated today, but the comment "Production code paths must NOT call this" is enforced only by convention — there's no runtime guard (e.g., `if (process.env.VITEST !== 'true') throw`).
- **Impact:** A future test or, worse, a script importing `vcr.ts` outside of vitest could mutate `VCR_DIR` and silently send cache writes to the wrong location.
- **Fix:** Guard `setVcrDirForTest` with `if (!process.env.VITEST) throw new Error(...)`; or thread `vcrDir` through a parameter on `cachedMessagesParse`/`cachedMessagesCreate`.

### WR-02: probeConnect leaks event handlers and has no socket-level timeout
- **File:** `scripts/fetch-prod-data.ts:59-68`
- **Issue:** No `.destroy()`/`.end()` on the error path; the socket lingers until garbage-collected. Also no `setTimeout` on the connect attempt — a SYN-stalling firewall can hold each probe indefinitely (Node's default connect timeout is OS-level, often 75-130 seconds). With the 50-iteration polling loop, that means the 10s deadline can be missed by minutes if probes don't return.
- **Impact:** Hanging fetch processes under bad network conditions; resource leak on every probe.
- **Fix:** Add `sock.setTimeout(500)` + a `'timeout'` handler that destroys the socket and resolves `false`. Always call `sock.destroy()` in both success and failure paths.

### WR-03: insertTable swallows JSON.stringify failure on bigint payload
- **File:** `src/__tests__/fixtures/load-primed.ts:246-263`
- **Issue:** `JSON.stringify(rows)` is called without a `bigintReplacer`. The fetch script writes JSONL using `bigintReplacer` (fetch-prod-data.ts:52-55, 202), so primary keys serialized to JSONL are strings — fine. But `chat_id` is a `bigint` column (schema.ts:170, 264, 301). If the fixture contains literal bigint values (e.g. after a re-read that doesn't pass through fetch's stringifier, or future tests that build fixture rows in memory), `JSON.stringify` throws `TypeError: Do not know how to serialize a BigInt`. Same gap in `synthesize-episodic.ts:327-348`.
- **Impact:** Latent crash if any caller hands `loadPrimedFixture` a fixture mixed with bigint-typed values. Diagnostic is poor.
- **Fix:** Reuse the existing `bigintReplacer` helper everywhere `JSON.stringify(rows)` is called for the bulk insert. Extract to a shared module since it's duplicated in 3 files.

### WR-04: synthesize-delta.ts argparse `seed` accepts `"0x10"` and `"1e3"`
- **File:** `scripts/synthesize-delta.ts:460-467`
- **Issue:** ```const seed = Number(raw.seed)``` then `!Number.isInteger(seed)` rejects floats but accepts hex (`Number('0x10') === 16`), exponential (`Number('1e3') === 1000`), and trims whitespace. The same lax parsing in `regenerate-primed.ts:124, 131`. `--seed 1e2` and `--seed 100` both produce seed=100, but `--seed 1e2` reads to an operator like "1 raised to 2" — surprise behavior for the SYNTH-07 byte-identical contract.
- **Impact:** Two CLI inputs that look distinct produce the same deterministic output, eroding the audit story for "this fixture came from this CLI invocation".
- **Fix:** Validate with a regex: `if (!/^-?\d+$/.test(raw.seed)) throw new UsageError(...)`. Same fix in regenerate-primed.

### WR-05: regenerate-primed.ts SIGINT handler doesn't wait for child to die
- **File:** `scripts/regenerate-primed.ts:222-228`
- **Issue:** ```const sigHandler = (): void => { if (activeChild) activeChild.kill('SIGTERM'); process.exit(130); };```. The composer sends SIGTERM to the child, then immediately exits. The child may need seconds to tear down its own docker container / SSH tunnel; the composer doesn't await child exit. End result: orphaned `docker-compose` processes and dangling SSH tunnels exactly as documented for fetch-prod-data.ts.
- **Impact:** Compose-project leakage on Ctrl-C of the composer; same pattern the synth-episodic comment block (line 530-535) explicitly warns against.
- **Fix:** Await `child.on('exit', ...)` for ≤5s before `process.exit(130)`; force SIGKILL on timeout.

### WR-06: generateWellbeingIfTableExists postgres client leaked on synthesis crash
- **File:** `scripts/synthesize-delta.ts:734-771`
- **Issue:** `const client = postgres(dbUrl, { max: 1 })` is `await client.end()`-ed in `finally`, but if `import('postgres')` itself throws (e.g. postgres-js not installed in some sandbox), control never reaches the try block and there's no client to close. Lower severity. More importantly, the `try` body has no error handling for the `to_regclass` query — a connection refused at line 736 throws unhandled out of the function, aborting the whole synthesize pipeline. The plan claims this is a "feature-detect skip on absent table", but it actually hard-aborts on absent DB.
- **Impact:** Surprise hard-fail when synthesizing in environments where a Postgres isn't running locally on 5433.
- **Fix:** Wrap the `to_regclass` SELECT in `try/catch`; on connection error, log `synth.wellbeing.skip { reason: 'db-unreachable' }` and return `[]`. Separately, only construct the client lazily after a port-probe succeeds.

### WR-07: deterministicUuid wastes 32 bits of state
- **File:** `scripts/synthesize-delta.ts:534-551`
- **Issue:** ```const words = [rng(), rng(), rng(), rng()].map((f) => Math.floor(f * 0x100000000))```. `rng()` returns `[0,1)` — multiplying by `2^32` and flooring gives at most 32 bits per word, fine. But the bytes laid out at indices 0-15 lose entropy in the version/variant nibble positions (bytes 6 and 8), which is expected for UUIDv4. The bigger concern: **`seed` parameter is treated as `seed >>> 0` (32-bit unsigned)**, but call sites pass seeds like `opts.seed + d * 1000 + synthPensieve.length` where for a 21-day fixture × 200 entries, the value can exceed 2^31. `>>> 0` truncates to 32 bits, so seeds 1 and 4294967297 collide — silent UUID collisions within the same fixture as the synthetic count grows.
- **Impact:** Theoretical-today, practical-once-fixtures-scale collision risk producing duplicate primary keys → `jsonb_populate_recordset` error or worse silent ON CONFLICT DO NOTHING drop.
- **Fix:** Use SHA-256 over the seed + index → first 16 bytes → set UUIDv4 version/variant bits. Or document and assert that seeds + index stay below 2^32.

### WR-08: load-primed.ts cleanup order doesn't clean conversations vs. references
- **File:** `src/__tests__/fixtures/load-primed.ts:227-241`
- **Issue:** `conversations` is deleted FIRST in the reverse-FK cleanup, but the doc-comment at line 132-143 has it conceptually at the top of the chain. The `conversations` table at schema.ts:166-178 is keyed by `chat_id` only — there's no FK INTO conversations from other rows in this loader. But there are FKs from `decisions.chat_id` (schema.ts:264) and `decision_capture_state.chat_id` (schema.ts:301) — if those reference `conversations.chat_id`, the cleanup order would break. Re-checking schema.ts:166-178: `conversations` doesn't appear to be referenced — but **the FK relationships are not visible in the schema file**. Without checking each table's FK, the loader's ordering is "matches one hand-traced graph and breaks silently on any new FK added in M009+."
- **Impact:** Adding a new FK referencing `conversations` will produce a 23503 error at next regen, which the test gate (running with empty conversations.jsonl) won't catch.
- **Fix:** Drop a comment listing the known FK graph at the top of the cleanup block, OR replace the manual ordering with a topological sort against `information_schema.referential_constraints`.

### WR-09: vcr.ts atomicWriteJSON tmp filename collides under high concurrency
- **File:** `src/__tests__/fixtures/vcr.ts:96-101`
- **Issue:** ```const tmp = `${path}.${process.pid}.tmp`;```. Two simultaneous in-process writes to the same hash key (e.g. parallel test workers within the same pid) overwrite each other's tmp file before `rename`. With `fileParallelism: false`, this is mitigated for vitest test files, but `synthesize-delta.ts` and `synthesize-episodic.ts` issue Haiku/Sonnet calls in serial loops — fine there. However, **two parallel Promise.all-style consolidate days hitting the same hash key** (possible if days share identical few-shot inputs) would race. Low likelihood but defense gap.
- **Impact:** Cache corruption under unanticipated concurrency. Currently masked by serial execution patterns.
- **Fix:** Include a random suffix: `` `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp` ``.

### WR-10: probeConnect missing connect-timeout makes openTunnel loop unreliable
- **File:** `scripts/fetch-prod-data.ts:59-105` (paired with WR-02)
- **Issue:** The `while (Date.now() < deadline)` loop calls `probeConnect` which can hang indefinitely on a stalled SYN. The 10s deadline check happens AFTER probeConnect resolves, so if a single probe takes 75s (OS default), the "deadline" semantic is lost. The retrospective notes that "tunnel won't establish" produces an operator-friendly error; in practice the operator may wait 5+ minutes for the first probe to time out.
- **Impact:** Bad operator UX under partial network failures.
- **Fix:** Add `sock.setTimeout(500)` to probeConnect (overlaps with WR-02 fix).

### WR-11: primed-sanity.test.ts uses raw SQL with forbidden-source string concat
- **File:** `src/__tests__/fixtures/primed-sanity.test.ts:124-128`
- **Issue:** ```const forbidden = FORBIDDEN_SOURCES.map((s) => `'${s}'`).join(', '); const rows = await db.execute<{ n: number }>(drizzleSql.raw(`SELECT COUNT(*)::int AS n FROM pensieve_entries WHERE source IN (${forbidden})`));```. `FORBIDDEN_SOURCES` is a `const as const` literal today, so no injection risk in practice. But `drizzleSql.raw(...)` with template interpolation is exactly the pattern that becomes a SQL injection vector the moment someone parameterizes `FORBIDDEN_SOURCES` from config/env/CLI. Lint warning for project convention "use drizzle parameterized queries; flag any raw string concatenation."
- **Impact:** Code smell, latent risk if `FORBIDDEN_SOURCES` becomes dynamic.
- **Fix:** Use `inArray(pensieveEntries.source, [...FORBIDDEN_SOURCES])` via Drizzle's typed API, or `drizzleSql`SELECT COUNT(*)::int AS n FROM pensieve_entries WHERE source IN (${drizzleSql.placeholder('forbidden')})`.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
