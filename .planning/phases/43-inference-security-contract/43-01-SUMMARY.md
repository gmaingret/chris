---
phase: 43-inference-security-contract
plan: 01
subsystem: memory/profiles
tags: [INJ-01, INJ-02, security, prompt-injection]
requires: []
provides:
  - sanitizeSubstrateText (exported from profiles/shared.ts)
  - LOCAL sanitizeSubstrateText (psychological-profile-prompt.ts; D-04 boundary)
  - INJ-01 + INJ-02 closure
affects:
  - src/memory/profiles/shared.ts
  - src/memory/profile-prompt.ts
  - src/memory/psychological-profile-prompt.ts
  - src/memory/__tests__/fixtures/injection-attacks.ts
  - src/memory/__tests__/profile-prompt.test.ts
  - src/memory/__tests__/psychological-profile-prompt.test.ts
tech_stack:
  patterns: [regex-escape, allowlist-regex]
key_files:
  created:
    - src/memory/__tests__/fixtures/injection-attacks.ts
  modified:
    - src/memory/profiles/shared.ts
    - src/memory/profile-prompt.ts
    - src/memory/psychological-profile-prompt.ts
    - src/memory/__tests__/profile-prompt.test.ts
    - src/memory/__tests__/psychological-profile-prompt.test.ts
decisions:
  - D-01: line-start hash-escape regex chosen over zero-width-space / reject-and-warn
  - D-02: triple-backtick neutralization (``` → ''') closes Phase 38 WR-01 fenced-directive class
  - D-04: psychological-profile-prompt.ts re-implements helper locally (no shared.ts import; D047 boundary)
  - D-06: epistemicTag allowlist /[^A-Za-z0-9_-]/g at both operational + psychological sites
metrics:
  duration_minutes: ~30
  tasks_completed: 5
  files_created: 1
  files_modified: 5
  tests_added: 47
  completed_at: "2026-05-15"
---

# Phase 43 Plan 01: Inference Security (INJ-01 + INJ-02) Summary

Defense-in-depth prompt-injection mitigation across both operational and
psychological profile assemblers via line-start markdown escape + triple-
backtick neutralization + epistemicTag allowlist.

## Commits

- `b3b20da` test(43-01): add canonical injection-attack fixtures (D-07)
- `54979c4` feat(43-01): add sanitizeSubstrateText helper + contract tests (D-01..D-04)
- `1e00beb` fix(43-01): INJ-01 — escape user-controlled substrate strings in operational prompt
- `a7cd006` fix(43-01): INJ-02 — escape user-controlled substrate in psychological prompt

## Per-task outcomes

### Task 1 (b3b20da) — Injection-attack fixtures

5 canonical fixtures + ALL_INJECTION_FIXTURES union in
`src/memory/__tests__/fixtures/injection-attacks.ts` (87 lines). Strings
locked verbatim against 43-CONTEXT.md D-07 and the Phase 34 BL-01 / Phase 38
WR-01 / WR-05 source findings.

### Task 2 (54979c4) — sanitizeSubstrateText helper + contract tests

`sanitizeSubstrateText(text: string): string` exported from
`src/memory/profiles/shared.ts`. Body:

```typescript
export function sanitizeSubstrateText(text: string): string {
  return text
    .replace(/(^|\n)(#+\s)/g, '$1\\$2')
    .replace(/```/g, "'''");
}
```

8 contract tests covering totality, idempotency, line-start escape, leading-
position escape, fence neutralization, empty-string boundary, and the
Phase 38 WR-01 + Phase 34 BL-01 canonical fixtures.

### Task 3 (1e00beb) — INJ-01 wired into operational buildSubstrateBlock

4 sanitization call sites in `src/memory/profile-prompt.ts`:
Pensieve content (post-truncation), episodic summary (post-truncation),
decision question (post-truncation), decision resolution (post-truncation).
epistemicTag passes through `/[^A-Za-z0-9_-]/g` allowlist.

24 new INJ-01 assertions parametrized over 4 operational dimensions
(6 cases × 4 dims). Existing 40 structural assertions still green; total
72 tests passing.

### Task 4 (a7cd006) — INJ-02 wired into psychological buildSubstrateBlock

LOCAL `sanitizeSubstrateText` function in
`src/memory/psychological-profile-prompt.ts` — NOT imported from shared.ts
per D-04 + D047 vocabulary boundary. Three lines of regex re-implemented
verbatim.

2 sanitization call sites: corpus content (post-truncation), episodic
summary (post-truncation). epistemicTag through same allowlist regex.

15 new INJ-02 assertions parametrized over hexaco + schwartz. Existing
24 structural assertions still green; total 39 tests passing. D-04 boundary
audit test asserts `sanitizeSubstrateText` is module-private.

### Task 5 — Full src/memory/__tests__/ Docker test gate

Full `bash scripts/test.sh src/memory/__tests__/` — **222 tests passed, 0
failed**. Includes 9 test files: confidence, context-builder, conversation,
profile-prompt (72), profile-updater, profiles, psychological-profile-prompt
(39), psychological-profile-updater.integration, relational.

## Deviations from Plan

### W-02 schema pre-check (resolved inline)

The PLAN-CHECK.md warning W-02 asked whether `psychological-schemas.ts` v3
boundary includes `data_consistency` in its `.strict()` allowed-keys set.
Pre-execution grep confirmed:

- `src/memory/profiles/psychological-schemas.ts:166-167`
  `HexacoProfileSchemaV4Boundary` and `:181-182` `SchwartzProfileSchemaV4Boundary`
  declare `data_consistency: zV4.number().min(0).max(1)` explicitly.
- `:173-176` `HexacoProfileSchemaV3Boundary.strict()` and `:186-189`
  `SchwartzProfileSchemaV3Boundary.strict()` both extend with
  `data_consistency: z.number().min(0).max(1)`.

The boundary schemas already accept the field — Plan 43-02's CONTRACT-03
persistence will not break the next live cron fire (Sun 2026-05-17 22:00 Paris).
No additional Plan 43-01 task needed.

### W-03 ROADMAP narrative-is-stale awareness

Plan 43-01 did NOT change ROADMAP.md. CONTEXT D-12/D-13 supersede the stale
ROADMAP success criterion #5 — plans correctly follow CONTEXT.md. ROADMAP
cleanup is a non-blocking cross-reference item batched with Phase 45.

## Known Stubs

None.

## Threat Flags

None — Phase 43 introduces NO new exfiltration / network / auth surface.

## Deferred Items

See `deferred-items.md` in this directory:
**DEFERRED-43-01** — `integration-m011-1000words.test.ts` PMT-03 baseline
failure (pre-existing in v2.6.1 baseline; NOT caused by Plan 43-01; routed to
Phase 45 / T9 backlog).

## Self-Check: PASSED

- `src/memory/__tests__/fixtures/injection-attacks.ts` exists (87 lines, 5 INJECT + 1 ALL_INJECTION_FIXTURES)
- All 4 commit hashes present in `git log --oneline`
- `grep -c "^export function sanitizeSubstrateText" src/memory/profiles/shared.ts` returns 1
- `grep -c "function sanitizeSubstrateText" src/memory/psychological-profile-prompt.ts` returns 1
- `grep -c "import.*sanitizeSubstrateText.*from.*shared" src/memory/psychological-profile-prompt.ts` returns 0 (D-04 boundary preserved)
- `bash scripts/test.sh src/memory/__tests__/` returns 0 (222/222 tests green)
