# Phase 6: Memory Audit - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Reconcile every fact Chris "knows" about Greg in the Pensieve against documented ground truth. No feature code changes — this is a data audit that produces a ground-truth reference document and proves an automated audit/correction pipeline works against a locally seeded database, then runs it against production with explicit approval.

</domain>

<decisions>
## Implementation Decisions

### Correction Strategy
- **D-01:** Incorrect Pensieve entries are soft-deleted (set `deletedAt`) and corrected versions re-inserted as new entries with `source='audit'`. Existing retrieval already filters `deletedAt IS NULL`, so corrections take effect immediately.
- **D-02:** Corrected entries get embeddings generated immediately (not deferred to pipeline) so they're retrievable right away.

### Ground-Truth Document
- **D-03:** Ground truth stored as a TypeScript const in `src/pensieve/ground-truth.ts` — a typed `Record<string, string>` (or similar structured export) with categorized facts (identity, location_history, property, business, financial). Directly importable by Phase 8 (structured fact injection) and Phase 10 (live tests).

### Audit Scope
- **D-04:** Audit covers only the fact categories in the M006 spec ground truth: location history, property (Golfe-Juan rental), business entities (MAINGRET LLC, Georgian IE), key dates (birth, moves), nationality, Panama residency, FI target. Other FACT/RELATIONSHIP-tagged entries are out of scope for this phase.
- **D-05:** Audit script generates a markdown report in `.planning/phases/06-memory-audit/` listing each entry reviewed, correctness status, and action taken (kept, soft-deleted, replaced).

### Database Access
- **D-06:** Run Chris locally with Docker Compose. A seed script inserts realistic Pensieve entries mimicking real conversations — some with correct facts, some with known errors (Cagnes-sur-Mer/Golfe-Juan mix-up, wrong move direction, etc.). Audit script runs against this local DB.
- **D-07:** After local testing passes, the same audit script runs against production with a dry-run flag first (report-only), then a wet-run with explicit user approval per D019.

### Claude's Discretion
- Seed data details: Claude decides the specific conversation entries to generate, as long as they cover the ground-truth categories and include the known error patterns from the M006 spec.
- Audit script structure: Claude decides internal implementation (query patterns, matching logic, report formatting).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Ground Truth & Requirements
- `M006_Trustworthy_Chris.md` — Contains the explicit ground truth facts in the "Memory audit" section and the full M006 acceptance criteria
- `.planning/REQUIREMENTS.md` §RETR-03 — The specific requirement this phase satisfies

### Architecture & Design
- `PRD_Project_Chris.md` — Overall project design, Pensieve concept, and Chris's role
- `.planning/PROJECT.md` §Key Decisions — D004 (append-only), D019 (production approval gate), D031 (structured fact injection)

### Code
- `src/db/schema.ts` — `pensieveEntries` table schema (content, epistemicTag, source, metadata, deletedAt)
- `src/pensieve/store.ts` — Entry insertion API
- `src/pensieve/retrieve.ts` — Semantic search with cosine similarity, filters `deletedAt IS NULL`
- `src/pensieve/embeddings.ts` — bge-m3 embedding generation

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `storePensieveEntry()` in `src/pensieve/store.ts` — can insert corrected entries with `source='audit'`
- `embedText()` in `src/pensieve/embeddings.ts` — generates bge-m3 embeddings for new entries
- `searchPensieve()` in `src/pensieve/retrieve.ts` — can query by semantic similarity to find fact-related entries
- Drizzle ORM + existing schema — soft-delete is just setting `deletedAt` via update query
- Docker Compose setup already exists for local development with Postgres + pgvector

### Established Patterns
- Fire-and-forget for embeddings, but audit needs synchronous embedding (D-02) — call `embedText()` directly rather than relying on the async pipeline
- `source` field on entries distinguishes provenance (telegram, gmail, immich, drive, document_import) — audit entries use `source='audit'`
- `epistemicTag` enum includes FACT and RELATIONSHIP — these are the primary tags to query

### Integration Points
- `src/pensieve/ground-truth.ts` (new file) — will be imported by Phase 8's structured fact injection and Phase 10's test suite
- Audit script connects via same `src/db/connection.ts` used by the app
- Seed script reuses `storePensieveEntry()` for realistic data insertion

</code_context>

<specifics>
## Specific Ideas

- The M006 spec calls out specific known errors: "Cagnes-sur-Mer" instead of "Golfe-Juan" for the rental property, wrong direction of move. The seed data should include these exact error patterns.
- Ground truth from M006 spec: French national, born June 15 1979 in Cagnes-sur-Mer. In Saint Petersburg, Russia until 2026-04-28. Then 1 month in Batumi, Georgia. Then Antibes, France June through end of August 2026. Then permanent relocation to Batumi. Owns rental property in Golfe-Juan (tenanted via Citya since October 2022). Operates MAINGRET LLC (New Mexico) + Georgian Individual Entrepreneur. Holds Panama permanent residency. FI target: $1.5M.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-memory-audit*
*Context gathered: 2026-04-13*
