# Phase 33: Profile Substrate — Discussion Log

**Mode:** `/gsd-discuss-phase --auto` (autonomous; recommended option auto-selected at every decision point; no AskUserQuestion calls)
**Date:** 2026-05-11

This log is for human reference (audits, retrospectives) — NOT consumed by downstream agents (researcher/planner/executor). Those agents read `33-CONTEXT.md`.

## Auto-mode log

The `--auto` flag instructed the discuss workflow to skip interactive prompts and pick the recommended option for every gray area. Below is the audit trail of selections.

### Gray-area selection

`[--auto] Selected all gray areas:`
1. Migration shape (atomic 1-file or split? row-seed strategy? hand-authored vs drizzle-kit?)
2. Per-profile schema shape (jsonb field names, sentinel-row pattern, schema_version semantics)
3. Reader API contract (never-throw vs typed-Result, schema-mismatch handling)
4. Zod schema location (per-profile sibling files vs shared schemas.ts)
5. profile_history table shape (shared with discriminator vs 4 separate tables)
6. Confidence module Phase ownership (Phase 33 substrate vs Phase 34 inference)

### Per-question selections

```
[auto] Migration shape — Q: "Hand-authored SQL vs drizzle-kit-generated?"
  → Selected: "Hand-authored SQL with drizzle-kit-generated meta snapshot" (recommended; mirrors M009 0006-0011 precedent)

[auto] Migration shape — Q: "All 5 tables in one migration vs split?"
  → Selected: "All in 0012" (recommended; HARD CO-LOC #M10-1; single drizzle meta regen)

[auto] Row-seed strategy — Q: "Seed from ground-truth.ts at migration time vs no seed?"
  → Selected: "Seed from ground-truth.ts" (recommended; PROF-03 lock; FEATURES.md day-1 UX rationale overrides ARCHITECTURE.md phantom-row concern because threshold check uses entryCount not row existence)

[auto] Sentinel-row pattern — Q: "name='primary' UNIQUE column for ON CONFLICT vs UUID-only pk?"
  → Selected: "name='primary' sentinel" (recommended; ARCHITECTURE Q7; enables future named-snapshot extension without schema change)

[auto] Non-retrofittable columns — Q: "schema_version + substrate_hash in 0012 vs add later?"
  → Selected: "Ship in 0012" (LOCKED; PITFALL M010-11; cannot be retrofitted)

[auto] Confidence type — Q: "real with CHECK constraint vs numeric(3,2) vs smallint percent?"
  → Selected: "real with CHECK (0-1)" (recommended; matches Zod z.number() semantics; no parse edge cases)

[auto] jsonb defaults — Q: "DEFAULT '[]'/{}' vs nullable jsonb?"
  → Selected: "DEFAULT non-null" (recommended; simplifies Zod parse + no impossible state)

[auto] Reader API error handling — Q: "Throw vs typed Result vs per-profile null?"
  → Selected: "Per-profile null + log warn" (recommended; PROF-04 lock; D005 + src/pensieve/retrieve.ts precedent)

[auto] Schema-mismatch handling — Q: "Throw vs warn-and-return-null on schema_version > 1?"
  → Selected: "Warn-and-return-null" (recommended; defends against future schema migrations propagating to old rows)

[auto] Zod schemas file location — Q: "Per-profile sibling files vs shared schemas.ts?"
  → Selected: "Shared src/memory/profiles/schemas.ts" (recommended; mirrors src/rituals/types.ts consolidation)

[auto] schema_version semantics — Q: "Bump on any change vs breaking changes only?"
  → Selected: "Breaking changes only" (recommended; additive fields stay version=1)

[auto] profile_history table — Q: "Shared table with discriminator vs 4 separate history tables?"
  → Selected: "Shared with profile_table_name discriminator" (recommended; simpler migration + single index)

[auto] confidence.ts phase ownership — Q: "Phase 33 substrate or Phase 34 inference?"
  → Selected: "Phase 33 substrate" (recommended; pure functions are testable without generators; D-19)

[auto] Ground-truth → profile mapping — Q: "Confirm D-10 mapping table?"
  → Selected: "Confirm mapping per inspection of src/pensieve/ground-truth.ts:24-63"
     jurisdictional ← nationality + current_location + next_move + permanent_relocation + residency_panama + business_georgia
     capital ← fi_target + business_us + business_georgia + residency_panama (entities)
     health ← (none; confidence=0)
     family ← (none; confidence=0)
```

### Deferred ideas surfaced

None. All scope-creep candidates were already filtered by the FEATURES research pass during `/gsd-new-milestone`. The 7 DIFF items and 7 ANTI items were locked there; this discussion stayed within the PROF-01..05 phase boundary.

### Claude's discretion items

Two items flagged for the planner's judgment (not blocking):

1. Exact jsonb field names per profile dimension (M010 spec is informal; planner should lock against FEATURES.md §2.1-2.4 canonical-fields tables vs simplify to what ground-truth.ts can seed).
2. `profile_history.snapshot` serialization shape (full row including metadata vs user-facing fields only). Recommended: full row.

### Canonical refs accumulated during discussion

All from research artifacts written during `/gsd-new-milestone`:
- `.planning/research/SUMMARY.md` + STACK.md + FEATURES.md + ARCHITECTURE.md + PITFALLS.md (all 5)
- `M010_Operational_Profiles.md` (project root spec)
- `.planning/PROJECT.md` + `.planning/REQUIREMENTS.md`
- Codebase pattern refs: `src/db/schema.ts`, `src/db/migrations/0006_rituals_wellbeing.sql`, `src/pensieve/ground-truth.ts`, `src/pensieve/retrieve.ts`, `src/rituals/types.ts`, `scripts/test.sh`, `scripts/regen-snapshots.sh`, `scripts/validate-journal-monotonic.ts`
- v2.4 archive refs: `25-01-PLAN.md` (most-similar atomic-migration precedent), `29-01-SUMMARY.md` (most-similar substrate-before-inference shape)

Full canonical-refs list lives in `33-CONTEXT.md` under `<canonical_refs>`.

## Single-pass cap

Per `--auto` mode's single-pass cap (workflows/discuss-phase/modes/auto.md), this discussion completed in one pass. No re-reading of own CONTEXT.md to find "gaps". Next step is plan-phase via auto-advance.
