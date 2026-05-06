---
slug: m009-rituals-no-fire
status: root_caused
created: 2026-05-05T12:40:00Z
updated: 2026-05-05T14:45:00Z
trigger: |
  M009 ritual infrastructure has never successfully fired in production.
  Two distinct bugs surfaced during /gsd-verify-work 29 (SC-1 verification).
related_phase: 29-weekly-review
related_uat: .planning/phases/29-weekly-review/29-HUMAN-UAT.md
severity: blocker
environment: production
prod_access:
  ssh: root@192.168.1.50
  containers:
    - chris-postgres-1 (db: chris/chris)
    - chris-chris-1 (bot)
---

# Debug Session: M009 rituals never fire in production

## Symptoms

### Expected Behavior

1. **weekly_review** ritual fires every Sunday 20:00 Europe/Paris (next due 2026-05-03 20:00 Paris from a Phase 29 deploy on 2026-04-29).
2. **daily_wellbeing** ritual fires every day 09:00 Europe/Paris.
3. **daily_journal** ritual fires every day 21:00 Europe/Paris.
4. Each fire writes a row to `ritual_fire_events` with `outcome` populated, sets `rituals.last_run_at`, advances `next_run_at` by one cadence, and dispatches the handler (Telegram message + Pensieve persist).

### Actual Behavior

**Bug 1 — Ritual table re-seeded May 4, losing all history + pushing weekly_review past Sunday May 3.**

```sql
SELECT name, last_run_at, next_run_at AT TIME ZONE 'Europe/Paris' AS paris_next, created_at AT TIME ZONE 'Europe/Paris' AS paris_created, skip_count
FROM rituals;
--   name           | last_run_at | paris_next            | paris_created              | skip_count
--   daily_journal  | NULL        | 2026-05-05 21:00:00   | 2026-05-04 11:36:33.994294 | 0
--   daily_wellbeing| NULL        | 2026-05-06 09:00:00   | 2026-05-04 11:36:33.994294 | 0
--   weekly_review  | NULL        | 2026-05-10 20:00:00   | 2026-05-04 11:36:33.994294 | 0
```

**Bug 2 — daily_wellbeing's next_run_at silently advanced today without firing, with healthy sweep.**

`daily_wellbeing.next_run_at` advanced from `2026-05-05 09:00 Paris` → `2026-05-06 09:00 Paris` without any sweep firing it (sweep at 07:00:00.009 UTC returned `rituals.sweep.empty` in 3ms).

## Current Focus

hypothesis: ROOT-CAUSED. See Resolution.
test: ✓ Done — combination of __drizzle_migrations forensics + pg_stat_user_tables + xmin transaction tracking + git log of commit 4d95285.
expecting: ✓ Done.
next_action: Apply fix per Resolution.

## Evidence

- timestamp: 2026-05-05T12:30:00Z
  source: live prod DB query (chris-postgres-1)
  finding: All 3 rituals have created_at = 2026-05-04 09:36:33.994294 UTC (= 2026-05-04 11:36:33.994294 Paris), identical to the microsecond.
- timestamp: 2026-05-05T12:30:00Z
  source: live prod DB query
  finding: ritual_fire_events count = 0. ritual_responses count = 0. ritual_pending_responses count = 0. ritual_config_events count = 0.
- timestamp: 2026-05-05T12:30:00Z
  source: container logs chris-chris-1 since 05:28 UTC restart
  finding: Per-minute sweep is healthy, every tick returns rituals.sweep.empty in 3-6ms. No errors. No fire events. No dispatcher logs.
- timestamp: 2026-05-05T12:30:00Z
  source: container logs at 07:00:00.009 UTC sweep tick
  finding: rituals.sweep.empty in 3ms. SQL returned 0 rows. So daily_wellbeing.next_run_at was already > 07:00 UTC at that moment.
- timestamp: 2026-05-05T12:30:00Z
  source: src/db/migrations/0008_wellbeing_seed.sql math
  finding: If migration ran at 2026-05-04 11:36 Paris, the seed produces next_run_at = 2026-05-05 09:00 Paris (NOT 2026-05-06). So Bug 2 advancement was NOT a seeding-time projection.

### NEW EVIDENCE (2026-05-05 14:00-14:45 UTC)

- timestamp: 2026-05-05T14:00:00Z
  source: prod __drizzle_migrations table joined to file SHA256 hashes
  finding: All 11 prod __drizzle_migrations rows correspond to files 0000_*.sql..0010_*.sql by hash (off-by-one because IDs are 1-indexed SERIAL while files are 0-indexed). Migration 0011 has NEVER been applied via drizzle. Hash of 0011_rename: `5973e927eda3798b207aab39c18e2ec6acc3ebcd822ab3cebd4b91f2643a2e59` is NOT present in __drizzle_migrations.
- timestamp: 2026-05-05T14:00:00Z
  source: src/db/migrations/meta/_journal.json (commit ac8fd98)
  finding: **Migration 0011 entry has `when: 1746576000000` = 2025-05-07 00:00 UTC (a YEAR ago)**. Drizzle migrator skips this migration on every boot because `lastDbMigration.created_at (1777538253770 = 2026-04-30) >= migration.folderMillis (1746576000000)`. The actual rename happened via Plan 31-02 Task 3 manual psql.
- timestamp: 2026-05-05T14:10:00Z
  source: prod __drizzle_migrations xmin transaction IDs
  finding: ids 7-11 (files 0006-0010) ALL have `xmin = 50703` — applied in ONE transaction on 2026-05-04 ~09:36 UTC. This was a re-application of all rituals-related migrations, including the seeds 0007/0008/0009. weekly_review.xmin also = 50703 (inserted in same transaction by migration 0009).
- timestamp: 2026-05-05T14:15:00Z
  source: prod pg_stat_user_tables for `rituals`
  finding: **`n_tup_ins = 3` and `n_tup_upd = 2`**. Only 3 inserts and 2 updates in the entire history of the database. Both UPDATEs are operator-driven (1 = Plan 31-02 rename, 2 = the daily_wellbeing advancement). **There is NO bot-driven advancement code path.**
- timestamp: 2026-05-05T14:20:00Z
  source: prod pg_stat_user_tables for `ritual_responses` and `ritual_fire_events`
  finding: BOTH tables have `n_tup_ins = 0` since DB init. The bot has NEVER inserted into either, confirming M009 has never fired successfully in production.
- timestamp: 2026-05-05T14:30:00Z
  source: rituals.xmin transaction IDs
  finding: weekly_review.xmin=50703 (migration insert), daily_journal.xmin=50721 (Plan 31-02 manual psql UPDATE rename), daily_wellbeing.xmin=50732 (operator UPDATE advancement). Current txid = 50737. Only 5 transactions since the daily_wellbeing advancement.
- timestamp: 2026-05-05T14:35:00Z
  source: git log 4d95285 commit message
  finding: **"DB cleanup separate (one-shot SQL on live to rewind daily_wellbeing's next_run_at to tomorrow 09:00 so it doesn't fire NOW at 17:00 Paris)."** Greg DOCUMENTED that he manually advanced daily_wellbeing.next_run_at as part of the 4d95285 deploy. This is the source of Bug 2 — operator action, not code bug.

## Eliminated

- hypothesis: D-04 catch-up ceiling advanced daily_wellbeing.
  why: At 07:00 UTC today, next_run_at was exactly 07:00 UTC — not stale by >1 cadence. Catch-up requires `now - next_run_at > 1 day` for daily.
- hypothesis: tryFireRitualAtomic advanced next_run_at first then handler errored silently.
  why: pg_stat shows ritual_fire_events.n_tup_ins = 0 (never inserted) AND rituals.n_tup_upd = 2 (only 2 updates total — both operator). No code path executed an UPDATE on rituals.
- hypothesis: A boot-time advancement path exists.
  why: chris container has 1 boot since stats started; rituals.n_tup_upd = 2 with both attributable. No additional UPDATE exists.
- hypothesis: Migration 0011 wiped + re-seeded rituals.
  why: Migration 0011 is UPDATE-only AND was never applied via drizzle (skipped due to year-stale `when` value). The rename happened via Plan 31-02 Task 3 manual psql.

## Resolution

### Bug 1 ROOT CAUSE — Migration journal/DB state desynchronization caused full re-application of migrations 0006-0010 on 2026-05-04 09:36 UTC.

**Mechanism:**
Drizzle's pg-core migrator (node_modules/drizzle-orm/pg-core/dialect.js:44-71) applies migrations using this logic:

```js
const lastDbMigration = await session.all(
  sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`
);
// captured ONCE before the loop, never updated inside
for (const migration of journalEntries) {
  if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) {
    await tx.execute(sql.raw(migration.sql));
    await tx.execute(sql`insert into drizzle.__drizzle_migrations (hash, created_at) values(${migration.hash}, ${migration.folderMillis})`);
  }
}
```

Some time before 2026-05-04 09:36 UTC, the prod DB had migrations 0000-0005 applied (`lastDbMigration.created_at = 1776524619341 = 0005's `when`). When the chris container booted on 2026-05-04 at 09:36 UTC (Plan 31-02 Task 4 redeploy), drizzle compared each journal entry's `when` against this stale `lastDbMigration` value and applied:
- 0006 (when=1777217039092 > 1776524619341): APPLIED — created `rituals` schema
- 0007 (when=1777348359976): APPLIED — INSERT `daily_voice_note` ritual row
- 0008 (when=1777376633000): APPLIED — INSERT `daily_wellbeing` ritual row
- 0009 (when=1777422168284): APPLIED — INSERT `weekly_review` ritual row
- 0010 (when=1777538253770): APPLIED — adjustment_dialogue
- 0011 (when=**1746576000000** = 2025-05-07): SKIPPED (when < lastDbMigration.created_at, false branch — but also, drizzle only updates lastDbMigration once)

All 5 migrations ran in ONE transaction (xmin 50703), inserting all 3 ritual rows with `created_at = now() = 2026-05-04 11:36:33.994294 Paris`.

But wait — if 0006-0010 had been applied BEFORE on 2026-04-26..30 (per their original drizzle-kit `when` values), why were they applied AGAIN on 2026-05-04?

Two possible upstream causes:
- **(a)** The pgdata volume was wiped/reset/restored from a backup taken before Phase 25 (before 2026-04-26). When the May 4 redeploy happened, drizzle saw migrations 0000-0005 in __drizzle_migrations and re-applied 0006-0010.
- **(b)** Someone manually `DELETE FROM drizzle.__drizzle_migrations WHERE id > 6` (or equivalent), perhaps during an earlier debug session when the journal was being "fixed" (cf. commit 76c1362 "fix(migrations): sync journal with applied migrations in production DB" — exact same class of bug previously bit Greg on 2026-04-13).

The forensic trail is now cold (Postgres logs only show checkpoint events, not statement-level activity, and there's no audit table). What matters is: **the journal/DB consistency invariant is broken**.

**Concrete fixes needed for Bug 1:**

1. **Fix the journal entry for 0011:** change `"when": 1746576000000` to a sensible value > 1777538253770 (e.g., `Date.now()` at fix time, or 1777538253771). Without this fix, drizzle will keep skipping migration 0011 forever — but it's currently a no-op rename so this is cosmetic.

2. **Sync __drizzle_migrations to reflect that migration 0011 has been "applied" (operator-applied via psql).** Add a row with hash = `5973e927eda3798b207aab39c18e2ec6acc3ebcd822ab3cebd4b91f2643a2e59` and created_at = the next sensible folderMillis. Otherwise if a future migration 0012 ships, the next deploy could replay 0011.

3. **Make seed migrations defensive against re-application.** The current `ON CONFLICT (name) DO NOTHING` is correct but only protects when the row exists. If something wipes the row first, re-seeding will silently happen. Consider:
   - Adding an audit/sentinel pattern (e.g., a `seeded_at` column on `rituals` that prevents re-seed if non-null) — but this is the wrong layer; the right answer is to fix the migration journal pipeline.
   - Adding an integration test for the deploy flow that asserts: "if you boot the bot against a DB with migrations 0..N already applied via the journal, no migrations re-run."

4. **Prevent future journal/DB drift via CI guardrail.** Add a CI check that diffs `_journal.json` against the previous main commit and fails if any prior entry's `when` value changes (only the new entry should be added). The `when: 1746576000000` value in commit ac8fd98 looks like a hand-edited mistake or template default — drizzle-kit normally sets `Date.now()`.

### Bug 2 ROOT CAUSE — Operator action by Greg, documented in commit 4d95285 message.

**Mechanism:**
Commit 4d95285 (2026-05-05 05:25 UTC) introduced the per-minute sweep cadence. Its body documents:

> "DB cleanup separate (one-shot SQL on live to rewind daily_wellbeing's next_run_at to tomorrow 09:00 so it doesn't fire NOW at 17:00 Paris)."

Greg ran this one-shot SQL manually on prod (likely via `docker exec chris-postgres-1 psql ... -c 'UPDATE rituals SET next_run_at = ... WHERE name = '\''daily_wellbeing'\''`). This is the second `n_tup_upd` on `rituals` (xmin 50732), advancing `next_run_at` from 2026-05-05 09:00 Paris to 2026-05-06 09:00 Paris.

Per pg_stat forensic evidence: there are only 2 UPDATEs in the entire DB history on `rituals`, both operator-driven (the rename + this advancement). No code path executed.

The commit message wording ("17:00 Paris") is misleading — the actual fire time was 09:00 Paris (= 07:00 UTC). The operator likely intended to push it forward to avoid an immediate fire after the cron change, but the timing didn't actually require it (07:25 Paris commit time is BEFORE the 09:00 Paris fire window). This is a self-inflicted skip, not a bug. **Bug 2 is RESOLVED — no code change needed.**

### Why M009 has never fired:

This is the meta-bug. Combining Bug 1 + Bug 2 + the original `0 21 * * *` cron mistake:

1. Phase 26 (mid-April): voice_note ritual deployed with cron `0 21 * * *` (21:00 Paris). Worked for daily_voice_note but at the time daily_voice_note was the only ritual.
2. Phase 27 (~April 22): daily_wellbeing added. Cron still `0 21 * * *`. So daily_wellbeing.next_run_at was set to next 09:00 Paris but the cron only checked at 21:00. At 21:00 Paris, daily_wellbeing was due (it was supposed to fire at 09:00, now 12h later) — but the catch-up ceiling at scheduler.ts:161-180 advanced it WITHOUT firing because age > 1 cadence period (24h).

   Wait — 12h is NOT > 24h, so catch-up wouldn't trigger. Per-tick LIMIT 1 ordering by `next_run_at ASC` would pick the OLDEST due, so daily_wellbeing would actually fire at 21:00 Paris that day. Let me re-examine.
   
   Actually: 09:00 → 21:00 = 12h late. Catch-up requires `> 24h` → doesn't trigger. `tryFireRitualAtomic` would advance `next_run_at` to next 09:00 (tomorrow) and call dispatchRitualHandler → fireWellbeing(). The Telegram send WOULD happen. So why hadn't it ever fired?

3. The Phase 29 deploy on 2026-04-29 (per UAT timestamp) added weekly_review. weekly_review.next_run_at would have been 2026-05-03 20:00 Paris (next Sunday). Did the bot send the wellbeing keyboard or journal prompt before May 4?

   ritual_responses + ritual_fire_events both have n_tup_ins = 0 since DB init. Before 2026-05-04 09:36 UTC (when the migrations re-applied), the row counts were also 0. So no ritual ever fired before May 4. Combined with the post-May-4 zero count: **rituals were never sent**.

4. The most likely explanation for "never fired before May 4" is that **the rituals table didn't exist as expected before May 4** — confirming hypothesis (a) about a pgdata reset. Pre-2026-05-04 09:36 UTC, the DB only had migrations 0000-0005 applied (no rituals schema, no seed rows). The chris container was running OLD code that referenced ritualSweepCron `0 21 * * *` and would have crashed or no-op'd on the missing rituals table.

   Actually the schema IS there (since migration 0006 ships in __drizzle_migrations as id 7), but the rows weren't, until 2026-05-04 09:36 UTC.

5. Post-May-4 09:36 UTC: rows existed, cron was `0 21 * * *`. At 21:00 Paris on May 4, daily_journal.next_run_at = 2026-05-05 21:00 (NOT due). daily_wellbeing.next_run_at = 2026-05-05 09:00 (NOT due). weekly_review = 2026-05-10. Nothing due. Sweep returned empty. ✓
6. May 5 05:28 UTC: container restart with per-minute sweep + the operator advancement (Bug 2). daily_wellbeing now 2026-05-06 09:00 (NOT due). daily_journal still 2026-05-05 21:00 (NOT due yet — fires tonight). weekly_review still 2026-05-10. Sweep returns empty all day. ✓ Matches logs.
7. **Tonight 2026-05-05 21:00 Paris (= 19:00 UTC) is the first natural fire window.** If daily_journal fires correctly, the substrate is healthy.

### Composite resolution + recommended action:

**No code bug exists in src/rituals/scheduler.ts or src/cron-registration.ts.** The substrate is sound. Both observed symptoms are the cumulative result of:
- An upstream operational event that desynced __drizzle_migrations vs. the journal (Bug 1, deeper root unknowable from current evidence).
- An operator step Greg took during the 4d95285 deploy (Bug 2, documented in commit message).

**Recommended fixes (none touch hot-path code):**

1. **(P0, low risk) Reset daily_wellbeing.next_run_at to 2026-05-05 09:00 Paris.** Wait, that's already passed. Set it to **2026-05-06 09:00 Paris** (which is what it currently is) and let it fire naturally tomorrow morning. **No SQL needed.** OR set it to **now() + 1 minute** to verify the wellbeing path works tonight as a smoke test. Operator decides.

2. **(P0, low risk) Confirm tonight's daily_journal 21:00 Paris fire works.** This is the natural confirming experiment. If `ritual_fire_events` gets a `fired` row at 19:00 UTC tonight, the substrate is verified end-to-end in prod.

3. **(P1, low risk) Fix the journal entry for migration 0011.** Edit `src/db/migrations/meta/_journal.json` to set 0011's `when` to a sensible value > 1777538253770 (e.g., `1777538253771` or `Date.now()` at fix time). Do NOT change anything else. Commit + deploy. On next container boot, drizzle WILL apply migration 0011 (it's a no-op WHERE name='daily_voice_note' since the row no longer has that name), and __drizzle_migrations will get a new id 12 row.

4. **(P1, low risk) Add CI guardrail for journal integrity.** A simple grep/parse check that:
   - All `when` values in `_journal.json` are monotonically increasing.
   - No previous `when` value changes between commits.
   - The `tag` matches the corresponding `.sql` filename.

5. **(P2, medium risk) Investigate the upstream Bug 1 cause.** Check Proxmox snapshots, docker volume backups, or backup restore logs for any pgdata operation between 2026-04-29 and 2026-05-04 that might explain why __drizzle_migrations had only 6 rows pre-deploy. If Greg ran `pg_restore`/`docker volume rm`/etc., document it for future post-mortems.

6. **(P3, defense in depth) Add a startup integrity check** to `src/db/migrate.ts`: after `migrate()` succeeds, verify `(SELECT count(*) FROM drizzle.__drizzle_migrations)` matches `_journal.json` entry count. Log a `migrations.drift.detected` warning if not. This would have caught the desync at boot time on 2026-05-04 and given Greg a chance to investigate before downstream rituals re-seeded.

### Specialist hint

**typescript** (drizzle-orm migrator semantics + jsonl integrity guardrail) — the proposed CI check + integrity warning sit in src/db/migrate.ts and a small CI script.

**postgres-expert** (low priority) — the deeper "what caused __drizzle_migrations to be missing rows" question would benefit from a pg-savvy review of postgres backup/restore practice in the deploy workflow.
