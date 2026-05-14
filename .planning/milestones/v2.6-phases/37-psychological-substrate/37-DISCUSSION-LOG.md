# Phase 37: Psychological Substrate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 37-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 37-psychological-substrate
**Mode:** `--auto` (autonomous; recommended-default selected for every gray area)
**Areas discussed:** Migration shape, Per-dim jsonb shape, Substrate loader return type, Schwartz score range, File locations, Confidence helpers, Boundary audit test, Cold-start seed semantics

---

## Migration shape

| Option | Description | Selected |
|--------|-------------|----------|
| One migration (0013) for all 3 tables — HARD CO-LOC #M11-1 | Mirror M010 0012 atomic shape; schema.ts + meta snapshot + test.sh psql line + journal entry ship together | ✓ |
| Three sequential migrations (0013/0014/0015), one per table | Smaller blast radius per migration | |
| One migration for tables + separate migration for seed-row INSERTs | Decouple DDL from data | |

**Selected:** One migration (recommended default per ARCHITECTURE §2 + PROJECT.md D042 + Phase 33 D-02 precedent).
**Rationale:** Phase 33 M010 0012 set the exact precedent for atomic multi-table migrations with Never-Retrofit columns + sentinel-row seeds + HARD CO-LOC. Splitting buys nothing semantically and triples the lineage maintenance.

---

## Per-dim jsonb shape

| Option | Description | Selected |
|--------|-------------|----------|
| `{ score, confidence, last_updated }` per REQUIREMENTS PSCH-02 | Locked by spec; aligns with Phase 38's per-fire update semantics | ✓ |
| `{ score, confidence, evidence_count }` per ARCHITECTURE §1 | Cheap inter-period consistency without history reads | |
| Add `dimension_consistency` field for per-dim trend tracking | ARCHITECTURE proposed alongside overall `data_consistency` | |

**Selected:** `{ score, confidence, last_updated }` (REQUIREMENTS contract).
**Rationale:** REQUIREMENTS PSCH-02 explicitly locks this shape. The `evidence_count` use case is subsumed by `profile_history` (write-before-upsert) + Sonnet-reported `data_consistency` (PGEN-07). `dimension_consistency` deferred to v2.6.1 (CONS-02). Spec wins over research recommendation.

---

## Substrate loader return type

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union: `{belowThreshold: true, ...} \| {belowThreshold: false, corpus, ...}` | Type-safe never-fire guards; downstream generators must branch explicitly | ✓ |
| Always-full object with optional `belowThreshold` flag | Simpler at signature site, harder at consumption site | |
| Throw on below-threshold; let the orchestrator catch | Mirrors fail-fast but breaks the never-throw pattern | |

**Selected:** Discriminated union.
**Rationale:** TypeScript narrows after `if (substrate.belowThreshold)` — generators (Phase 38) cannot accidentally pass undefined `corpus` to Sonnet. Mirrors M009 ritual return-shape pattern. Throw was rejected: substrate-not-ready is an expected state, not an exceptional one.

---

## Schwartz score range

| Option | Description | Selected |
|--------|-------------|----------|
| 1.0–5.0 (unified with HEXACO) — Zod schema simplification + visual `/profile` consistency | Same per-dim shape across HEXACO/Schwartz; Sonnet output trivially constrained | ✓ |
| 0.0–1.0 (academic Schwartz normalization) | Closer to PVQ-21 normalized importance | |
| Academic raw scale (-1 to 7 importance rating) | Highest fidelity to academic Schwartz | |

**Selected:** 1.0–5.0 unified.
**Rationale:** PSCH-03 says "same per-dim shape as PSCH-02"; locking 1.0–5.0 maintains Zod schema reuse + display consistency. Academic-fidelity transform deferrable to Phase 39 display layer if ever needed (M014 candidate per CIRC-01).

---

## File locations (substrate loader + schemas + tests)

| Option | Description | Selected |
|--------|-------------|----------|
| `src/memory/profiles/psychological-{shared,schemas}.ts` + `__tests__/psych-boundary-audit.test.ts` | Sibling files in operational profile dir; per REQUIREMENTS PSCH-07 verbatim | ✓ |
| Separate `src/memory/psychological-profiles/` subdir | SUMMARY.md suggestion; physical separation | |
| Mixed (schemas in `profiles/`, substrate loader in dedicated dir) | Hybrid | |

**Selected:** Sibling files in `src/memory/profiles/`.
**Rationale:** REQUIREMENTS PSCH-07 explicitly says `src/memory/profiles/psychological-shared.ts`. Co-locating with operational sibling files keeps domain (profiles) bounded and avoids deep nesting. Boundary-audit test (PSCH-10) handles cross-contamination at the lint level — physical separation is unnecessary defense.

---

## Confidence helpers — where to place new constants

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `src/memory/confidence.ts` in-place with `MIN_SPEECH_WORDS`, etc. | Single source of truth for thresholds; mirrors Phase 33 D-19 | ✓ |
| New `src/memory/psych-confidence.ts` | Physical separation between entry-count and word-count thresholds | |
| Inline constants in `psychological-shared.ts` | Co-located with the consumer | |

**Selected:** Extend `confidence.ts` in-place.
**Rationale:** Phase 33 D-19 established that confidence helpers are substrate (shipped with schemas), not inference. The two threshold systems (entry-count for operational, word-count for psychological) coexist without composing — same file, separately named constants, no shared helper. PITFALL §2 explicitly warns against compositing them.

---

## Boundary audit test — regex precision

| Option | Description | Selected |
|--------|-------------|----------|
| Word-boundary regex `\b(jurisdictional\|capital\|health\|family)\b` + reverse direction | REQUIREMENTS PSCH-10 verbatim; mirrors M008 boundary-audit | ✓ |
| AST-based import-graph audit | Higher signal, much more code | |
| Substring match (no word boundary) | Catches more false positives | |

**Selected:** Word-boundary regex sweep, both directions.
**Rationale:** REQUIREMENTS PSCH-10 specifies the exact regexes. M008 `boundary-audit.test.ts` is the proven pattern. AST is overkill for a vocabulary fence. Word boundary prevents `attached_url`-style false positives that substring matching would create.

---

## Cold-start seed semantics

| Option | Description | Selected |
|--------|-------------|----------|
| All dims `NULL`; `overall_confidence=0`; `substrate_hash=''`; `last_updated` NULL | REQUIREMENTS PSCH-05 verbatim + audit-trail consistency | ✓ |
| All dims `{}` empty objects; `overall_confidence=0` | Avoids null handling | |
| No seed row; reader returns null until first fire | Simpler migration | |

**Selected:** All dims `NULL`; substrate_hash `''`; last_updated NULL.
**Rationale:** REQUIREMENTS PSCH-05 locks this. The null-vs-empty-object distinction matters for "never inferred" semantics (Phase 39 `/profile` displays "insufficient data — need N more words" when overall_confidence=0 AND last_updated IS NULL). substrate_hash empty string (not NULL) ensures first-fire hash comparison evaluates as "changed" — though Phase 38 generators don't short-circuit on hash anyway (PGEN-06).

---

## Claude's Discretion

The following were noted as planner-flex items in 37-CONTEXT.md `<decisions>`:

- Exact source-file placement of three new `pgTable` exports in `src/db/schema.ts` (after `profileFamily`, before `profileHistory` per ARCHITECTURE §1 — line numbers may have shifted post-M010).
- Internal naming of per-dim shape factory functions in `psychological-schemas.ts` (e.g., `makePerDimSchema(...)` vs explicit per-type factories — nominal-typing requirement holds either way).
- `profile_history.snapshot` jsonb serialization (full row vs user-facing fields only — Phase 37 ships only the schema; Phase 38 owns the write decision).
- Whether to split the 3 sentinel-row INSERTs into one composite multi-row INSERT per table or three separate statements (cosmetic).

## Deferred Ideas

Captured in 37-CONTEXT.md `<deferred>`:

- `evidence_count` per-dim field (ARCHITECTURE proposal, not in REQUIREMENTS) — subsumed by `profile_history` + PGEN-07 `data_consistency`. v2.6.1 candidate only.
- Per-dim `dimension_consistency` field — v2.6.1 / CONS-02.
- `WORD_SATURATION = 20000` constant — Phase 38 (if needed); calibration post-empirical per SAT-CAL-01.
- Schwartz academic score range (-1 to 7) — Phase 39 display transform candidate; M014.
- `profile_attachment` population orchestration — D028 activation gate; v2.6.1 / ATT-POP-01.
- Source-filter generalization (multi-source psychological substrate) — defer until a second source exists.
- `PsychologicalSubstrate<T>` typed-by-profile-type narrowing — revisit when Phase 38 reveals the need.
