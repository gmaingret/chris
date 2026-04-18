---
phase: 14-capture-flow
plan: 03
type: execute
wave: 1
depends_on: [01]
files_modified:
  - src/decisions/suppressions.ts
  - src/decisions/index.ts
autonomous: true
requirements: [CAP-06]
must_haves:
  truths:
    - "Greg can persist trigger-phrase suppressions via addSuppression()"
    - "Suppressions survive a simulated process restart (DB-backed, not in-memory)"
    - "isSuppressed(text, chatId) returns true iff any of that chat's suppressed phrases is a case-insensitive substring of `text`"
    - "Suppressions are scoped per chatId (no cross-chat leakage)"
  artifacts:
    - path: "src/decisions/suppressions.ts"
      provides: "addSuppression + isSuppressed + listSuppressions helpers"
      exports: ["addSuppression", "isSuppressed", "listSuppressions"]
  key_links:
    - from: "src/decisions/suppressions.ts"
      to: "decisionTriggerSuppressions (Drizzle table)"
      via: "db.insert / db.select with eq(chat_id)"
      pattern: "decisionTriggerSuppressions"
---

<objective>
Implement CAP-06 persistence primitive (D-16, D-17): DB-backed suppression list with trim + lowercase normalization on write; case-insensitive substring match on read; per-chat scoping.

Purpose: The Phase 14 surface-of-CAP-06 is ONLY `/decisions suppress <phrase>` (no list/unsuppress — those are Phase 17 per D-16). This plan ships the DB helpers; the slash-command handler comes in Plan 05 (bot wiring).
Output: `src/decisions/suppressions.ts` exporting three helpers. Turns `suppressions.test.ts` GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-capture-flow/14-CONTEXT.md
@.planning/phases/14-capture-flow/14-RESEARCH.md
@src/db/schema.ts
@src/db/connection.ts
@src/decisions/capture-state.ts
@src/decisions/__tests__/suppressions.test.ts

<interfaces>
From src/db/schema.ts (after Plan 01 Task 1):
```typescript
export const decisionTriggerSuppressions: PgTable<{ ... }>;
// columns: id (uuid PK), chatId (bigint NOT NULL), phrase (text NOT NULL, stored lowercased), createdAt (timestamptz)
// unique(chatId, phrase); index(chatId).
```

From src/decisions/capture-state.ts (existing pattern — how Drizzle queries are written in this module):
```typescript
import { db } from '../db/connection.js';
import { eq } from 'drizzle-orm';
// await db.select().from(table).where(eq(table.chatId, chatId)).limit(1);
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement suppressions.ts DB helpers</name>
  <files>src/decisions/suppressions.ts, src/decisions/index.ts</files>
  <read_first>
    - src/decisions/capture-state.ts (existing Drizzle query shape — db import path, eq usage, bigint chatId convention)
    - src/db/schema.ts (confirm decisionTriggerSuppressions is now exported after Plan 01)
    - src/db/connection.ts (db export)
    - src/decisions/__tests__/suppressions.test.ts (drives exact API surface — read test file to confirm function signatures)
    - .planning/phases/14-capture-flow/14-CONTEXT.md §"/decisions suppress" (D-16, D-17 — phrase-only, trimmed+lowercased, substring match on full user message before regex)
  </read_first>
  <behavior>
    Tests in `suppressions.test.ts` require:
    - `addSuppression(chatId: bigint, phrase: string): Promise<void>` — trims and lowercases `phrase` before insert; duplicate inserts are a no-op (absorbed by `(chatId, phrase)` unique constraint).
    - `isSuppressed(text: string, chatId: bigint): Promise<boolean>` — returns true iff ANY suppression row for that chat has its phrase as a case-insensitive substring of `text`.
    - `listSuppressions(chatId: bigint): Promise<string[]>` — returns stored (lowercased) phrases for that chat; newest first via `createdAt DESC`. Used by the slash-command handler in Plan 05 for optional echo; phase-17 surface will add full CRUD.
    - Per-chat scoping: chatId=1 cannot see chatId=2's suppressions.
    - Persistence across simulated restart: tests may drop+re-import the module and assert rows still queryable.
  </behavior>
  <action>
    Create `src/decisions/suppressions.ts`:

    ```typescript
    import { db } from '../db/connection.js';
    import { decisionTriggerSuppressions } from '../db/schema.js';
    import { eq, desc, and } from 'drizzle-orm';

    export async function addSuppression(chatId: bigint, phrase: string): Promise<void> {
      const normalized = phrase.trim().toLowerCase();
      if (normalized.length === 0) {
        throw new Error('suppression phrase must be non-empty after trimming');
      }
      if (normalized.length > 200) {
        throw new Error('suppression phrase exceeds 200 character limit');
      }
      await db
        .insert(decisionTriggerSuppressions)
        .values({ chatId, phrase: normalized })
        .onConflictDoNothing({
          target: [decisionTriggerSuppressions.chatId, decisionTriggerSuppressions.phrase],
        });
    }

    export async function isSuppressed(text: string, chatId: bigint): Promise<boolean> {
      const haystack = text.toLowerCase();
      const rows = await db
        .select({ phrase: decisionTriggerSuppressions.phrase })
        .from(decisionTriggerSuppressions)
        .where(eq(decisionTriggerSuppressions.chatId, chatId));
      for (const row of rows) {
        if (haystack.includes(row.phrase)) return true;
      }
      return false;
    }

    export async function listSuppressions(chatId: bigint): Promise<string[]> {
      const rows = await db
        .select({ phrase: decisionTriggerSuppressions.phrase })
        .from(decisionTriggerSuppressions)
        .where(eq(decisionTriggerSuppressions.chatId, chatId))
        .orderBy(desc(decisionTriggerSuppressions.createdAt));
      return rows.map((r) => r.phrase);
    }
    ```

    Add exports to `src/decisions/index.ts`: `export * from './suppressions.js';` (append; preserve existing re-exports).

    Notes:
    - Length bounds (`> 0`, `<= 200`) mitigate T-14-03-01 (unbounded input → DoS via bloated table / large regex-haystack).
    - `onConflictDoNothing` absorbs the unique-constraint race — tests that add the same phrase twice expect no-throw.
    - `isSuppressed` uses JS `String.prototype.includes()` after lowercasing BOTH sides — matches D-17 "case-insensitive substring" exactly.
    - Drizzle parameterizes the `eq()` query, mitigating T-14-03-02 (SQL injection via `<phrase>`).
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/suppressions.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export async function (addSuppression|isSuppressed|listSuppressions)" src/decisions/suppressions.ts` returns 3.
    - `grep -c "phrase.trim().toLowerCase()" src/decisions/suppressions.ts` returns ≥1 (write-side normalization).
    - `grep -c "haystack.*includes\|includes(row.phrase)" src/decisions/suppressions.ts` returns ≥1 (read-side substring match).
    - `grep -c "onConflictDoNothing" src/decisions/suppressions.ts` returns ≥1 (dedup race absorbed).
    - `grep -c "length.*200\|> 200\|<= 200" src/decisions/suppressions.ts` returns ≥1 (length bound).
    - `grep -c "length.*=== 0\|=== 0\|length > 0" src/decisions/suppressions.ts` returns ≥1 (non-empty check).
    - `npx vitest run src/decisions/__tests__/suppressions.test.ts` exits 0 (all test cases GREEN).
  </acceptance_criteria>
  <done>All `suppressions.test.ts` cases GREEN; addSuppression normalizes + dedup-safe; isSuppressed case-insensitive substring; listSuppressions per-chat; length bounds enforced.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `<phrase>` argument from Telegram `/decisions suppress` | Arbitrary user text via Grammy `ctx.message.text` parsing (Plan 05 will parse) |
| DB row → substring match haystack | Suppressed phrase compared against future user messages; oversized phrase would bloat match cost |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-03-01 | DoS | Unbounded phrase length | mitigate | 200-char limit rejected at `addSuppression` entry; tests will exercise the boundary |
| T-14-03-02 | Tampering (SQL injection) | phrase column insert | mitigate | Drizzle `db.insert(...).values({phrase})` is fully parameterized; no raw string interpolation anywhere in the module |
| T-14-03-03 | Tampering (suppression list abuse — over-broad match suppresses legitimate future decisions) | isSuppressed substring match | accept | This is the explicit UX per D-16; Phase 17 id-based suppression + `/decisions list-suppressions` + `/decisions unsuppress` remediate; documented in PITFALL 7 (RESEARCH.md) |
| T-14-03-04 | Privacy (cross-chat leakage) | scoping | mitigate | Every query filters `eq(chatId, chatId)`; multi-chat test asserts non-leakage |
</threat_model>

<verification>
- `npx vitest run src/decisions/__tests__/suppressions.test.ts` exits 0.
- `addSuppression` normalizes + absorbs duplicates.
- `isSuppressed` is case-insensitive substring, per-chat.
- Length bounds enforced.
</verification>

<success_criteria>
CAP-06 primitive shipped. The slash-command binding comes in Plan 05; after that, CAP-06 is closed.
</success_criteria>

<output>
After completion, create `.planning/phases/14-capture-flow/14-03-SUMMARY.md`.
</output>
