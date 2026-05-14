# Phase 43: Inference Security & Contract Enforcement — Discussion Log

**Date:** 2026-05-14
**Mode:** `--auto` (recommended-option selection; no AskUserQuestion turns)
**Areas auto-selected:** all 5 gray areas listed below

This log is a human-reference audit trail for the autonomous discussion pass. The canonical decision record is `43-CONTEXT.md`.

---

## Gray Area 1 — Escaping approach (INJ-01 / INJ-02)

**Question:** Which escaping/neutralization approach should `buildSubstrateBlock` apply to user-controlled Pensieve `content`, episodic `summary`, decision `decisionText`/`resolution` to defeat Pitfall §7 prompt-injection?

**Options considered:**

1. **Line-start hash-escape** — `replace(/(^|\n)(#+\s)/g, '$1\\$2')` — preserves content visually, neutralizes anchor parsing. (Phase 34 BL-01 reviewer's recommended minimum.) [recommended — chosen]
2. **Hash-strip** — `replace(/^#+\s+/gm, '')` — drops the `#` chars entirely. (Phase 38 WR-01 reviewer's pattern.) Loses information; weaker audit signal.
3. **Zero-width-space prepend on `##`** — invisible at training time; weak semantic anchor.
4. **Fenced JSON array restructure** — reviewer's "Better" defense-in-depth. Larger refactor; deferred to v2.7+.
5. **Reject-with-warning** — drops legitimate Greg markdown content. Defeats robustness goal.
6. **Content-length limit alone** — explicitly noted by reviewers as insufficient (canonical attack fits in 200 chars).

**[auto] Selected: Option 1** (line-start hash-escape) combined with Option 2's triple-backtick neutralization in the same helper. Documented as D-01 through D-04 in CONTEXT.md.

---

## Gray Area 2 — Reserved anchors guarded

**Question:** Which reserved anchors must the escape transform protect against being forged inside user content?

**Options considered:**

1. **Generic `^#+\s` regex** — covers every markdown header used by both operational and psychological assemblers in one rule. [recommended — chosen]
2. **Explicit anchor allowlist** — string-match each of `## CURRENT PROFILE STATE`, `## SUBSTRATE`, `## Output Format`, `## Substrate`, `## Profile Focus`, etc. Brittle; misses future anchors.
3. **Hybrid (regex + explicit token-reject)** — regex for headers + explicit reject for the literal `CURRENT PROFILE STATE` / `END SUBSTRATE` tokens. Defense-in-depth but adds reject path that can drop legitimate content.

**[auto] Selected: Option 1.** Generic header escape covers the documented attack class (Phase 34 BL-01 + Phase 38 WR-01). Plus dedicated `epistemicTag` allowlist regex (Phase 38 WR-05 closure) to prevent operational-vocab boundary leak. Documented as D-05 + D-06.

---

## Gray Area 3 — CONTRACT-03 storage location

**Question:** Where should Sonnet's `data_consistency` field from psychological inference persist?

**Options considered:**

1. **New column on `profile_hexaco`, `profile_schwartz`, `profile_attachment`** — same shape as operational profile tables (`real NOT NULL DEFAULT 0` + CHECK 0..1). Symmetric with M010 design; queryable per row. [recommended — chosen]
2. **`profile_history.snapshot` jsonb extension** — snapshot captures the PRIOR row; this period's `data_consistency` lands in NEXT fire's snapshot. Asymmetric; CONS-01 must compensate for one-fire lag.
3. **Dedicated `psychological_profile_data_consistency` table** — over-engineered for a single real column per profile.

**[auto] Selected: Option 1.** The `profile_history` polymorphic snapshot will automatically include the new column once it exists on the profile tables (since snapshots are full-row copies). One write site, queryable directly, symmetric with M010. Documented as D-12 through D-14.

---

## Gray Area 4 — Migration numbering

**Question:** What migration slot does this phase's column-add take, given Phase 45 also ships migrations?

**Options considered:**

1. **Take `0014` slot — Phase 45 takes `0015`/`0016`** — Phase 43 has no dependencies; lands first. v2.6.1-REQUIREMENTS.md's references to `0014_psychological_check_constraints` and `0015_phase33_seed_defaults_backfill` get bumped to 0015/0016 at Phase 45 execution time. [recommended — chosen]
2. **Reserve slot for Phase 45 — take `0016`** — preserves the requirement-doc's stated numbers but requires gap reservation across phases (operationally fragile; another agent could grab `0015` mid-cycle).
3. **Squash all v2.6.1 migrations into a single `0014_v2_6_1_cleanup.sql`** — defeats the "one migration per logical concern" principle.

**[auto] Selected: Option 1.** Migration numbering is mechanical; sequence by execution order. Phase 45 will update REQUIREMENTS.md cross-references during its own execution. Documented as D-15 + D-16.

---

## Gray Area 5 — Test fixtures for injection

**Question:** Should canonical injection-attack strings be checked into the repo as test fixtures, and if so, where + what format?

**Options considered:**

1. **TypeScript module at `src/memory/__tests__/fixtures/injection-attacks.ts`** — strongly-typed exports, imported by both operational and psychological prompt tests. [recommended — chosen]
2. **JSON file at `tests/fixtures/injection-attacks.json`** — language-agnostic; weaker typing; deviates from existing fixture pattern (`src/memory/__tests__/fixtures/` is the established location).
3. **Inline test constants per test file** — duplication risk between operational + psychological test files; drift over time.

**[auto] Selected: Option 1.** Co-located with consumers, strongly typed, importable. Five canonical fixtures documented as D-07 covering operational state-anchor, output-format override, fenced directive, psychological routing anchor, and operational-tag boundary leak. Two new unit tests assert the assembled prompt does NOT contain unescaped fixture tokens. Documented as D-07 + D-08.

---

## Areas not flagged as gray (auto-resolved without enumeration)

- **CONTRACT-01 implementation shape** — Phase 34 BL-02 reviewer recommended fix is unambiguous (add `dataConsistency` to destructure list); no decision required beyond confirming the symmetry edit at `profiles.ts:215-231`. Documented as D-09.
- **CONTRACT-02 implementation shape** — Phase 34 BL-03 reviewer's "Recommended" code block is the canonical fix. Documented as D-10 + D-11.
- **Test discipline** — already governed by user's "always run full Docker tests" memory rule. Documented as D-17 + D-18.

---

## Scope creep redirected

None. Discussion stayed inside the 5 phase requirements.

---

## Deferred ideas captured

See `<deferred>` section in CONTEXT.md — fenced-JSON-array substrate rendering, Anthropic SDK injection-sentinel API watch, CONS-01/CONS-02, Phase 38 WR-03/04/06.

---

*Auto-mode pass cap respected: single pass; no re-read self-feeding loop.*
