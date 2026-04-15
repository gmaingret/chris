# Stack Research — M007 Decision Archive

**Domain:** Decision capture + forecast accountability extension on top of existing Chris stack
**Researched:** 2026-04-15
**Confidence:** HIGH (existing stack already production-validated; new additions verified against Context7 / official docs / npm registry)

## Bottom Line

**M007 requires effectively zero new runtime dependencies.** The existing Chris stack (Node.js 22 ESM, Vitest 4.1, Drizzle 0.45, node-cron 4.2, `franc`, PostgreSQL 16) already contains every primitive M007 needs. The only "addition" is making deliberate use of Vitest's built-in fake-timer API (`vi.useFakeTimers` / `vi.setSystemTime`) for the synthetic fixture — no package install required.

One **optional** dev-only helper (`date-fns` for rolling-window date math) is listed as a convenience. Native `Date` arithmetic and SQL `interval` predicates can do the same job; recommended only if the team prefers readability over zero-dep purism.

---

## Recommended Stack Additions

### Runtime dependencies (NEW)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| *(none)* | — | — | Every runtime capability M007 needs is already present: Drizzle pgEnum for `status`, `node-cron` for scheduling, `franc` for EN/FR/RU language detection of trigger phrases, Anthropic SDK for Haiku accuracy classification, postgres driver for `interval`-based rolling windows. Adding new runtime deps here would be invention for its own sake. |

### Dev dependencies (NEW)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| *(none required)* | — | Mock-clock for synthetic `resolve_by` fixture tests | **Vitest 4.1.4 already ships this.** `vi.useFakeTimers()` is internally backed by `@sinonjs/fake-timers` (the de-facto industry standard; `@sinonjs/fake-timers@15.3.2` published 2026-04-11). `vi.setSystemTime(date)` mocks `Date.now()`, `new Date()`, `performance.now()`, and `hrtime`. `vi.advanceTimersByTime(ms)` drains queued `setTimeout`/`setInterval`. All three APIs are ESM-clean and work under Node 22 with the default `threads` pool. Installing `@sinonjs/fake-timers` directly would duplicate what Vitest already bundles. |

### Optional dev helper (judgment call — NOT required)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | 4.1.0 | Compute 30/90/365-day rolling-window boundaries for `/decisions` accuracy stats in pure JS | Only if the team wants `subDays(new Date(), 30)` readability over `new Date(Date.now() - 30*86400000)`. Tree-shakeable ESM, zero deps, TypeScript-native. **Preferred alternative:** push the window math into SQL (`WHERE resolved_at >= now() - interval '30 days'`) — zero new deps, executes at the DB, leverages indexes. Recommendation: **skip `date-fns`; do the windowing in SQL.** |

---

## What Each New Capability Maps To

### (a) Mock-clock for synthetic `resolve_by` fixture

**Use Vitest's built-in fake timers. No install needed.**

```ts
import { beforeEach, afterEach, vi, test, expect } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.setSystemTime(new Date('2026-04-15T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

test('decision with 7-day resolve_by surfaces exactly 7 days later', async () => {
  await captureDecision({ resolveBy: addDays(new Date(), 7) });

  // Advance wall clock 7 days
  vi.setSystemTime(new Date('2026-04-22T09:00:00Z'));
  await runProactiveSweep();

  const decision = await getDecision(id);
  expect(decision.status).toBe('due');
});
```

**Why this is the right primitive:**
- `vi.setSystemTime` affects every `new Date()` and `Date.now()` call in the process — the proactive-sweep code does not need to be refactored to accept an injected clock. It keeps calling `new Date()` and gets back the mocked time.
- No external timer library to version-pin or update.
- Drizzle timestamp comparisons in Postgres run against the **database's** clock, not Node's. The fixture test must either:
  1. Use a test schema and pass explicit `resolve_by` values in the past, and let Node's mocked clock drive the sweep's `new Date()` comparisons that happen in JS before the SQL query, **or**
  2. Have the sweep select `WHERE resolve_by <= $1` with `$1 = new Date()` so the mocked JS clock flows into the SQL predicate. This is the preferred pattern — keep `now()` out of the SQL itself.

**Forbidden alternative:** do NOT install `@sinonjs/fake-timers` directly — Vitest already bundles it. Installing it separately risks version-skew between the two copies.

### (b) Drizzle ORM pattern for state-machine enum with enforced transitions

**Use `pgEnum` for the value constraint. Enforce transitions in a typed service-layer function — Drizzle does not (and should not) do transition validation.**

```ts
// schema.ts
import { pgEnum, pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const decisionStatus = pgEnum('decision_status', [
  'open',
  'due',
  'resolved',
  'reviewed',
]);

export const decisions = pgTable('decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  decision: text('decision').notNull(),
  alternatives: jsonb('alternatives').$type<string[]>().notNull(),
  reasoning: text('reasoning').notNull(),
  prediction: text('prediction').notNull(),
  falsificationCriterion: text('falsification_criterion').notNull(),
  resolveBy: timestamp('resolve_by', { withTimezone: true }).notNull(),
  status: decisionStatus('status').notNull().default('open'),
  resolution: text('resolution'),
  resolutionNotes: text('resolution_notes'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});
```

**Transition enforcement lives in `src/decisions/state.ts`:**

```ts
const ALLOWED: Record<DecisionStatus, DecisionStatus[]> = {
  open:     ['due'],
  due:      ['resolved'],
  resolved: ['reviewed'],
  reviewed: [],
};

export function assertTransition(from: DecisionStatus, to: DecisionStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Illegal decision transition: ${from} → ${to}`);
  }
}
```

Every transition goes through a single `transitionDecision(id, nextStatus)` helper that reads the current row, asserts the transition, and `UPDATE`s in one transaction (`db.transaction(...)`). This matches the PRD's "no implicit transitions" requirement and keeps the rule in TypeScript where it can be unit-tested.

**Optional belt-and-suspenders (DB-level):** add a `CHECK` constraint or trigger via raw SQL in a Drizzle migration to reject illegal transitions at the DB. Recommended **only** if the team fears someone bypassing the service layer with raw SQL — for a single-user self-hosted bot, the TS-layer enforcement is sufficient.

### (c) Cron/deadline scheduling — EXTEND the existing proactive sweep, do not add new infrastructure

**Nothing new needed.** `node-cron@4.2.1` is already orchestrating the proactive sweep (M004). The M007 deadline scheduler should be a **new trigger** added to the existing sweep orchestrator, not a parallel cron.

Integration shape:

```
Existing sweep (M004):
  silence → commitment → pattern → thread

M007 adds a FIFTH SQL-first trigger, runs BEFORE the Opus triggers:
  decision_deadline → silence → commitment → pattern → thread
```

The new trigger:
1. `SELECT ... FROM decisions WHERE status = 'open' AND resolve_by <= now()` — cheap SQL, same pattern as the existing silence/commitment gates (D010 two-phase execution).
2. For each hit: `UPDATE decisions SET status = 'due'` via the state-machine helper.
3. Enqueue a resolution prompt into the existing proactive message path.
4. Respect the existing mute/quiet state (D015 `proactive_state`) — no new muting surface.

**Do NOT:**
- Install a second cron library (`node-schedule`, `bree`, `cron`, `toad-scheduler`) — that would fragment scheduling across two mechanisms.
- Introduce a job queue (`bullmq`, `agenda`, `graphile-worker`) — overkill for a single-user bot, adds Redis or another moving part.
- Spawn a separate cron process — the proactive sweep already owns the "things that happen on a timer" surface.

### (d) Rolling 30/90/365-day window date math

**Do it in SQL, not JS. No new library.**

```ts
// Haiku-classified accuracy stats over rolling windows
const stats = await db.execute(sql`
  SELECT
    COUNT(*) FILTER (WHERE resolved_at >= now() - interval '30 days')  AS resolved_30d,
    COUNT(*) FILTER (WHERE resolved_at >= now() - interval '90 days')  AS resolved_90d,
    COUNT(*) FILTER (WHERE resolved_at >= now() - interval '365 days') AS resolved_365d,
    AVG(accuracy_score) FILTER (WHERE resolved_at >= now() - interval '30 days')  AS accuracy_30d,
    AVG(accuracy_score) FILTER (WHERE resolved_at >= now() - interval '90 days')  AS accuracy_90d,
    AVG(accuracy_score) FILTER (WHERE resolved_at >= now() - interval '365 days') AS accuracy_365d
  FROM decisions
  WHERE status = 'reviewed'
`);
```

**Why:**
- PostgreSQL's `interval` and `now()` handle rolling windows natively. No JS date arithmetic, no timezone footguns.
- `FILTER (WHERE ...)` aggregates 3 windows in a single query — one DB round-trip for `/decisions`.
- The mocked-clock fixture test drives `now()` by injecting an explicit cutoff parameter (`$1::timestamptz - interval '30 days'`) instead of relying on the DB's wall clock. Pass `new Date()` from Node (which is mocked by Vitest) as the anchor.

**Fixture pattern for the synthetic test:**
```ts
const anchor = vi.getMockedSystemTime() ?? new Date();
// pass `anchor` into the accuracy query as $1
```

The existing postgres.js driver + Drizzle's `sql` template already supports this. **No `date-fns`, no `dayjs`, no `luxon` required.**

---

## Installation

```bash
# Nothing to install. M007 ships on the existing lockfile.
```

If the team decides to add the optional `date-fns` helper despite this doc's recommendation:

```bash
npm install date-fns@4.1.0
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Vitest built-in fake timers | `@sinonjs/fake-timers` 15.3.2 standalone | Never in this project — Vitest bundles it; direct install causes version-skew. Valid only outside Vitest (e.g., node:test). |
| Vitest built-in fake timers | Hand-rolled `Clock` interface injected everywhere | Only if the existing sweep code is so coupled to `new Date()` that mocking globally breaks something else. Current M004 sweep uses `new Date()` directly — Vitest's global mock is a clean fit. |
| Extending proactive sweep | Separate cron for decision deadlines | Never — fragments "when does Chris do timed things" across two mechanisms. |
| SQL `interval` for rolling windows | `date-fns` `subDays` + JS filter in memory | Only if the accuracy stats move to an in-memory computed view. For DB-backed stats, SQL wins. |
| Drizzle `pgEnum` + TS state-machine helper | XState / robot3 state-machine library | Overkill — 4 states, 3 legal transitions, one actor (the decision row). A 10-line `assertTransition` function is more auditable than pulling in a library. |
| Drizzle `pgEnum` + TS helper | DB-level trigger enforcing transitions | Add only if external processes will write to `decisions` outside the app. Not the case here. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@sinonjs/fake-timers` as a direct dep | Vitest already bundles it; dual-install causes version-skew and two copies of the same prototype patcher | `vi.useFakeTimers()` / `vi.setSystemTime()` |
| `node-schedule`, `bree`, `cron`, `toad-scheduler` | Second scheduling library fragments the "timed things" surface across the codebase | Extend the existing `node-cron`-driven proactive sweep |
| `bullmq`, `agenda`, `graphile-worker` | Job queue is architectural overkill for a single-user bot; adds Redis or worker infra | In-process trigger inside the existing sweep |
| `xstate`, `robot3` | 4 states + 3 transitions is not worth a state-machine library; hides simple logic behind a DSL | 10-line `assertTransition` function + `pgEnum` |
| `date-fns-tz`, `luxon`, `dayjs` | The rolling-window math is trivial in SQL; timezone handling is already settled at the proactive-sweep layer (M004) | SQL `now() - interval '30 days'` + existing timezone handling |
| A new ORM or raw SQL migration tool | Project standard is Drizzle + drizzle-kit auto-migrate on startup | `pgEnum` in the existing schema, `npm run db:generate` |
| A new language-detection library for FR/RU trigger phrases | `franc` is already installed and M006 confirmed it handles EN/FR/RU with the short-message threshold (D021) | Reuse `franc`; detect trigger phrases per-language after `franc` returns the code |
| A new LLM client | Anthropic SDK is already the three-tier carrier (D001); Haiku is the right tier for accuracy classification | Reuse existing Anthropic client; Haiku prompt for prediction-vs-resolution classification |

---

## Integration Points With Existing Stack

| M007 capability | Existing subsystem it extends | No new code required at the boundary |
|-----------------|-------------------------------|--------------------------------------|
| Decision trigger-phrase detection | Chris engine mode detection (M002) | Add a pre-mode hook that checks for trigger phrases after `franc` language detection; if matched, enter capture-protocol sub-conversation. Same pattern as M004 mute detection. |
| 5-question capture protocol | Grammy conversation state | Use the existing per-session state pattern from M006 declined-topics. |
| `decisions` table | Drizzle schema + drizzle-kit auto-migrate on startup (D016) | One new table, one new enum — generated via `npm run db:generate`. |
| Lifecycle state machine | No existing analog | New `src/decisions/state.ts` module. |
| Deadline scheduler | Proactive sweep orchestrator (M004) | Add a fifth SQL-first trigger at the front of the trigger list; reuse two-phase execution (D010). |
| Resolution flow | Pensieve append-only entries (D004) | Resolution + post-mortem text stored as normal Pensieve entries with source `telegram`, plus denormalized copies on the `decisions` row. |
| `/decisions` Telegram command | Grammy command handlers (M003 `/sync` pattern) | New command handler; Haiku classification via existing Anthropic client. |
| Rolling-window stats | postgres.js driver + Drizzle `sql` template | Single SQL query with `FILTER (WHERE resolved_at >= now() - interval 'N days')`. |
| Mock-clock fixture test | Vitest test suite (existing pattern from M006 live integration) | `vi.useFakeTimers()` + `vi.setSystemTime()` in `beforeEach`; no extra deps. |

---

## Version Compatibility (spot-checks against existing lockfile, 2026-04-15)

| Package | Installed | Latest on npm | Compatibility with Node 22 ESM |
|---------|-----------|---------------|--------------------------------|
| `vitest` | 4.1.2 | 4.1.4 | Full ESM; fake-timers work with `threads` pool (default). Upgrade to 4.1.4 optional — patch release. |
| `drizzle-orm` | 0.45.2 | 0.45.2 | `pgEnum` is stable; `.$type<...>()` for typed jsonb arrays works under strict TS. |
| `node-cron` | 4.2.1 | 4.2.1 | ESM-native in v4. Existing sweep already uses it. |
| `postgres` | 3.4.5 | 3.4.5 | `interval` and `now()` via template `sql` tag work as-is. |
| `franc` | 6.2.0 | 6.2.0 | ESM-native; already used for EN/FR/RU in M006. |
| `@sinonjs/fake-timers` (bundled in vitest) | 15.x (transitive) | 15.3.2 (2026-04-11) | Same engine that powers `vi.useFakeTimers`; do **not** install directly. |

---

## Sources

- **npm registry** (2026-04-15) — `@sinonjs/fake-timers@15.3.2` (2026-04-11), `vitest@4.1.4`, `date-fns@4.1.0`, `drizzle-orm@0.45.2`, `node-cron@4.2.1` verified via `npm view`.
- **Vitest official docs** — https://vitest.dev/api/vi.html — confirmed `vi.useFakeTimers()` is backed internally by `@sinonjs/fake-timers`, `vi.setSystemTime()` affects `Date.now()` / `new Date()` / `performance.now()` / `hrtime`, threads pool is the ESM-safe default. **Confidence: HIGH.**
- **Drizzle ORM docs** — https://orm.drizzle.team/docs/column-types/pg — confirmed `pgEnum` enforces value constraints only; transition enforcement is app-layer. **Confidence: HIGH.**
- **Existing `package.json` at /home/claude/chris/package.json** — confirmed node-cron 4.2.1, vitest 4.1.2, drizzle-orm 0.45.2, franc 6.2.0, postgres 3.4.5, @anthropic-ai/sdk 0.80.0 already installed. **Confidence: HIGH.**
- **Existing PROJECT.md decisions** — D001 (three-tier LLM), D010 (two-phase sweep), D015 (proactive_state), D018 (no skipped tests — Docker Postgres for integration), D021 (franc language detection). All M007 additions align with these. **Confidence: HIGH.**

---
*Stack research for: M007 Decision Archive*
*Researched: 2026-04-15*
*Confidence: HIGH — no new runtime deps needed; all additions are reuse of existing primitives*
