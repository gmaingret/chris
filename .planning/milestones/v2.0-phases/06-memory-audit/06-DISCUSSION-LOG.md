# Phase 6: Memory Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 06-memory-audit
**Areas discussed:** Correction strategy, Ground-truth doc format, Audit scope, Live DB access

---

## Correction Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Soft-delete + re-insert | Set deletedAt on wrong entries, insert corrected versions with source='audit' | ✓ |
| Annotate via metadata | Add metadata flag but leave entry retrievable | |
| Ground-truth doc only | Don't touch entries, let Phase 8 handle via structured fact injection | |

**User's choice:** Soft-delete + re-insert
**Notes:** Preserves history while fixing what Chris retrieves. Works with existing retrieval filter.

| Option | Description | Selected |
|--------|-------------|----------|
| Generate embeddings immediately | Run embedding pipeline on corrected entries right away | ✓ |
| Defer to pipeline | Insert without embeddings, rely on async pipeline | |

**User's choice:** Generate immediately
**Notes:** Ensures corrected entries are retrievable right away.

---

## Ground-Truth Doc Format

| Option | Description | Selected |
|--------|-------------|----------|
| TypeScript const | .ts file exporting typed object, directly importable by Phase 8 and Phase 10 | ✓ |
| Structured YAML/JSON | Machine-parseable but requires loader | |
| Markdown reference doc | Human-friendly but requires parsing for programmatic use | |

**User's choice:** TypeScript const
**Notes:** Directly importable, type-safe, no parsing overhead.

| Option | Description | Selected |
|--------|-------------|----------|
| src/pensieve/ground-truth.ts | Co-located with Pensieve module | ✓ |
| src/config/ground-truth.ts | In config directory | |
| tests/fixtures/ground-truth.ts | In test fixtures | |

**User's choice:** src/pensieve/ground-truth.ts
**Notes:** Co-located with the module it validates. Phase 8 imports from same package.

---

## Audit Scope

| Option | Description | Selected |
|--------|-------------|----------|
| M006 spec facts only | Location history, property, business entities, key dates, nationality, residency, FI target | ✓ |
| All FACT-tagged entries | Broader review of all FACT entries | |
| FACT + RELATIONSHIP tags | Broadest scope including relationship descriptions | |

**User's choice:** M006 spec facts only
**Notes:** Tight scope matching the ground truth provided in M006 spec.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, markdown report | Summary in .planning/phases/06-memory-audit/ with per-entry findings | ✓ |
| Console output only | Print to stdout, no persistent report | |
| You decide | Claude's discretion | |

**User's choice:** Yes, markdown report
**Notes:** Useful for verifying Phase 6 success criteria.

---

## Live DB Access

| Option | Description | Selected |
|--------|-------------|----------|
| Script against production DB | Direct connection to live Postgres on Proxmox | |
| Dump then audit locally | pg_dump, restore locally, audit, apply back | |
| Manual SQL | Manual queries via psql | |

**User's choice:** Other — Run Chris locally, fill Pensieve with realistic conversation via seed script, use local DB for audit
**Notes:** Keeps production untouched during development. Creates reproducible test environment.

| Option | Description | Selected |
|--------|-------------|----------|
| Script inserts realistic entries | Seed script with correct and incorrect facts, automated and repeatable | ✓ |
| Manual Telegram conversations | Chat with local Chris organically | |
| Import from production | Copy subset of real entries | |

**User's choice:** Script inserts realistic entries
**Notes:** Fully automated and repeatable. Includes known error patterns from M006 spec.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, with approval gate | Run against production after local testing, dry-run first, wet-run with explicit approval | ✓ |
| Local only for now | Defer production cleanup | |
| You decide | Claude's discretion | |

**User's choice:** Yes, with approval gate
**Notes:** Per D019 — production changes require explicit user confirmation. Dry-run first.

---

## Claude's Discretion

- Seed data details (specific conversation entries to generate)
- Audit script internal structure (query patterns, matching logic, report formatting)

## Deferred Ideas

None — discussion stayed within phase scope.
