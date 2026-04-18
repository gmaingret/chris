---
phase: 06-memory-audit
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/db/schema.ts
  - src/pensieve/ground-truth.ts
  - src/pensieve/__tests__/ground-truth.test.ts
  - src/scripts/audit-pensieve.ts
  - src/scripts/audit-pensieve-production.ts
  - src/scripts/seed-audit-data.ts
  - src/scripts/__tests__/audit-pensieve.test.ts
  - src/scripts/__tests__/seed-audit-data.test.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 6: Code Review Report (Fresh Standard-Depth Review)

**Reviewed:** 2026-04-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Fresh standard-depth review of the Phase 6 Memory Audit surface five days after
ship (2026-04-13), with the codebase now at v2.1 M007 head (2026-04-18).
`src/db/schema.ts` has picked up M007 decision primitives (`decisions`,
`decision_events`, `decision_capture_state`, `decision_trigger_suppressions`,
plus four new enums) that were not part of Phase 6 but are in-scope for this
review because the file now holds them. The Phase 6 module `ground-truth.ts`
and its test are unchanged and clean. The three audit scripts in
`src/scripts/` have evolved through prior review iterations (WR-01..WR-04
fixed) but still carry three Warning-class concerns and a handful of
informational notes.

The three Warnings are:

1. **The "synchronous embedding" contract in the audit and seed scripts is
   not actually synchronous.** `embedAndStore` is a fire-and-forget helper
   that catches its own errors and returns `void` — it cannot surface an
   embedding failure to the caller. The audit wet-run counts an incorrect
   entry as "corrected" even when the corrected replacement has no
   embedding, producing a silently unretrievable row.
2. **The wet-run audit loop has no transactional boundary.** A crash after
   the soft-delete UPDATE but before the INSERT/embedding step leaves the
   original (correct-or-not) entry soft-deleted and no replacement present.
   The next iteration continues and the outer `catch` only exits the process.
3. **`audit-pensieve-production.ts` mutates the original `content` column
   in-place** (prefixes `[SUPERSEDED by audit] `) which violates the
   append-only Pensieve constraint documented in PLAN.md D004. The comment
   at line 85 acknowledges "production has no deleted_at" but the right fix
   is schema alignment (add the column, or mark via metadata only), not
   lossy mutation of the verbatim user utterance.

Everything else is Info-level: false-positive risk in the string-includes
matcher, a birth-year gap that is already self-commented, an unused
`_originalContent` parameter by convention, no localhost guard on the
production script, and the previously-noted standalone-amount matcher
(IN-01 carried forward).

Schema.ts is consistent internally. The absence of `ACCOUNTABILITY` from
`conversationModeEnum` is intentional and corroborated by
`src/chris/engine.ts:392-393` ("ACCOUNTABILITY is not a DB-stored
conversation mode — skip saving"). `decisionStatusEnum` matches the D-04
lifecycle map in PLAN.md. No schema-level findings.

## Warnings

### WR-01: "Synchronous" embedding contract silently swallows failures

**File:** `src/scripts/audit-pensieve.ts:396-399`, `src/scripts/seed-audit-data.ts:180-181`
**Issue:** Both scripts call `await embedAndStore(...)` and comment it as
"synchronous embedding per D-02 — not fire-and-forget for audit entries"
(audit-pensieve.ts:397, seed-audit-data.ts:180). But `embedAndStore`'s
implementation (`src/pensieve/embeddings.ts:87-111`) is fire-and-forget by
contract — it wraps the entire body in `try { ... } catch { logger.warn(...) }`
and returns `void`. The awaited `Promise<void>` resolves successfully even
when the embedding pipeline throws or `embedText` returns null (line 92:
"embedText returned null" is a warn-log, not an exception). Consequence:
the audit loop increments `mutationCount` and pushes a `soft_deleted` result
for a correction that has no retrievable embedding — an entry that will
never match any semantic query. For the audit script, this is the worst
possible silent failure because the whole point of the corrected replacement
is that Chris retrieves it instead of the soft-deleted original.
**Fix:** Either (a) introduce a separate `embedAndStoreStrict` that throws
on failure and use it from these scripts, or (b) after `await embedAndStore`,
verify the embedding landed with a follow-up count query on
`pensieve_embeddings` for the returned `corrected.id` and throw if missing.
Option (a) is cleaner:

```ts
// src/pensieve/embeddings.ts
export async function embedAndStoreStrict(entryId: string, content: string): Promise<void> {
  const embedding = await embedText(content);
  if (!embedding) throw new Error(`embedText returned null for ${entryId}`);
  await db.insert(pensieveEmbeddings).values({ entryId, embedding, chunkIndex: 0, model: config.embeddingModel });
}

// audit-pensieve.ts:398, seed-audit-data.ts:181
await embedAndStoreStrict(corrected.id, correctedContent);
```

### WR-02: Wet-run audit has no transactional boundary between soft-delete and insert

**File:** `src/scripts/audit-pensieve.ts:377-399`
**Issue:** Inside the wet-run branch the code performs three sequential DB
operations per incorrect entry: UPDATE (soft-delete), INSERT (corrected
replacement), embedAndStore (insert into pensieve_embeddings). These run
as separate statements outside any transaction. If the process is killed,
the DB connection drops, or the INSERT/embed throws between statements,
the original entry is soft-deleted but no replacement exists — violating
the invariant that every soft-deleted audit entry has a corrected successor.
The outer CLI `catch` in `main().catch(...)` (line 461-463) only exits
the process; it does not roll back in-flight mutations. Running the audit
again after a partial failure would re-query non-deleted FACT/RELATIONSHIP
entries and miss the gap entirely.
**Fix:** Wrap each per-entry mutation trio in `db.transaction(async (tx) => { ... })`:

```ts
if (!options.dryRun) {
  await db.transaction(async (tx) => {
    await tx.update(pensieveEntries).set({ deletedAt: new Date() }).where(eq(pensieveEntries.id, entry.id));
    const [corrected] = await tx.insert(pensieveEntries).values({ /* ... */ }).returning();
    if (corrected) await embedAndStoreStrict(corrected.id, correctedContent); // see WR-01
  });
  mutationCount++;
  results.push({ /* ... */ });
}
```

Note that `embedAndStore` currently uses the top-level `db` client, not a
transaction handle — to properly bind the embedding insert to the same
transaction you'd need to plumb `tx` through, or accept that the embedding
lives in a separate transaction (pragmatic given the fire-and-forget
contract elsewhere, but then WR-01's strict variant is mandatory).

### WR-03: Production audit mutates original `content` in-place (lossy)

**File:** `src/scripts/audit-pensieve-production.ts:96-105`
**Issue:** The production audit cannot use a `deleted_at` column because
the production `memories` table has no such column. The chosen workaround
is to prepend `[SUPERSEDED by audit] ` to the existing `content` via an
UPDATE statement (line 98). This is a lossy in-place mutation of the
verbatim user utterance, which directly contradicts PLAN.md D004 ("Append-only
Pensieve, no lossy operations. Soft-delete only via explicit Greg command.")
and D011 (source provenance). The original Telegram text is gone after the
update; only the prefixed version remains. If the audit itself is later
found to be wrong, the original utterance cannot be recovered from this
table alone (WAL retention is not a user-visible restore path).
**Fix:** Two structural options, pick one:

- **Preferred:** align the production schema with the local schema by adding
  `deleted_at timestamptz` to `memories` (idempotent ALTER, backfills to
  NULL), then the production adapter becomes a one-line diff from the
  local script. This also closes the "code duplication across two audit
  scripts" surface.
- **Minimal:** stop touching `content` in the UPDATE. Move the audit marker
  into `metadata` only, e.g. `{ auditSuperseded: true, auditDate, originalContentChecksum }`.
  Retrieval-side filtering can exclude `metadata->>'auditSuperseded' = 'true'`
  rows, and the original speech stays intact.

```ts
// Minimal fix — drop the content rewrite entirely:
await sql`
  UPDATE memories
  SET metadata = ${JSON.stringify({
    ...existingMetadata,
    auditSuperseded: true,
    auditDate: new Date().toISOString(),
    supersededBy: null,  // filled after corrected insert
  })}
  WHERE id = ${entry.id}::uuid
`;
```

## Info

### IN-01: Rental context detection fires on bare "apartment" keyword

**File:** `src/scripts/audit-pensieve.ts:54-58`
**Issue:** `isRentalContext` returns true for any content containing the
word "apartment" regardless of ownership context. A sentence like
"I visited my friend's apartment in Cagnes-sur-Mer last weekend" would
trigger the rental branch and be flagged as an incorrect rental property
(Cagnes-sur-Mer instead of Golfe-Juan), producing a false-positive
correction. Risk is bounded by the small, well-known Pensieve dataset but
worth documenting.
**Fix:** Tighten the trigger to require ownership/rental verbs alongside
"apartment", e.g. `(lower.includes('apartment') && (lower.includes('my apartment') || lower.includes('our apartment') || lower.includes('rented')))`.
Or lean on the existing Citya-gated branch and drop the bare "apartment"
disjunct.

### IN-02: Birth-year errors outside 1979 fall through as unrelated

**File:** `src/scripts/audit-pensieve.ts:168-171`
**Issue:** `hasWrongDate` only fires when the content contains the literal
string `'1979'` but uses a non-matching date format. Content stating a
completely different year (e.g. "I was born in 1980 in Nice") falls through
as `{matched: false}` and is reported as `unrelated` rather than `incorrect`.
The code's own inline comment at lines 168-170 acknowledges this limitation.
Not worth fixing for the current dataset (no known wrong-year entries)
but worth preserving the comment and adding a test case that documents the
boundary if the audit is ever extended to cover broader birth-date drift.
**Fix:** Either widen the detector (`const hasAnyYear = /\b(19|20)\d{2}\b/.test(lower); if (hasAnyYear && !hasCorrectDate) { ... incorrect }`) or leave as-is with the comment.

### IN-03: Standalone amount matcher lacks FI context (carried forward from prior review)

**File:** `src/scripts/audit-pensieve.ts:237-240`
**Issue:** The fallback matcher on lines 237-240 treats any content containing
"$1,500,000", "1,500,000", or "1.5 million" as a correct `fi_target` entry
without requiring FI or financial-independence context. Content like "the
property costs $1,500,000" would be classified as correct FI target. Same
finding as the prior review's IN-01; remains present.
**Fix:** Add a nearby-keyword check (`target|goal|need|save|retire|independence`)
or document the intentional recall-bias with an inline comment.

### IN-04: Production script has no localhost guard / confirmation flag

**File:** `src/scripts/audit-pensieve-production.ts:12-26`
**Issue:** `seed-audit-data.ts:142-153` explicitly refuses to run against
any DB whose URL is not localhost/127.0.0.1 (Pitfall 5 guard). The
production audit script has no analogous guard or explicit `--yes-prod`
confirmation flag, even though by design it performs destructive writes
(see WR-03) against the live Proxmox DB at 192.168.1.50:5434. The
invocation discipline is documented in PLAN.md D016/D019 but there is no
code-level belt-and-suspenders. A misconfigured DATABASE_URL pointing at
the wrong production-like DB would execute silently.
**Fix:** Require an explicit `--confirm-production` flag to proceed with
a non-dry-run:

```ts
const hasProdConfirm = args.includes('--confirm-production');
if (!isDryRun && !hasProdConfirm) {
  console.error('Refusing to wet-run without --confirm-production flag');
  process.exit(1);
}
```

### IN-05: String `.includes` matching has no word boundaries

**File:** `src/scripts/audit-pensieve.ts` (throughout `matchEntryToGroundTruth`)
**Issue:** Every matcher uses `lower.includes('word')` which matches substrings
without word boundaries. `lower.includes('french')` also matches "frenchman",
"frenchify", "unfrench". `lower.includes('batumi')` also matches hypothetical
"batumis". Risk is low for the closed vocabulary but the current design
cannot distinguish e.g. "I'm half French, half Georgian" (nationality
entry) from "I ordered French fries" (unrelated).
**Fix:** Switch to word-boundary regexes (`/\bfrench\b/i`) for the keyword
triggers, or accept the current approach with a comment. Not urgent.

### IN-06: `_originalContent` parameter in `generateCorrectedContent` is unused

**File:** `src/scripts/audit-pensieve.ts:256`
**Issue:** The `_originalContent` parameter (underscore-prefixed by convention
to silence unused-arg lint) is never read in the function body. Current
corrections are generated from `GROUND_TRUTH_MAP[key]` only, ignoring the
original utterance. If the audit is later extended to preserve tone or
linguistic cues from the original speech (e.g. keeping it in Greg's voice),
this parameter will be ready. No action needed now — leaving this as a
forward-reference note for maintainers.
**Fix:** None required. Keep the parameter and comment clarifying the
intentional deferral, or remove the parameter and add it back when needed.

---

_Reviewed: 2026-04-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
