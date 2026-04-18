# Phase 13: Schema & Lifecycle Primitives — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 13-schema-lifecycle-primitives
**Areas discussed:** Event log shape, Legal transition map, `decisions` column set, Replay/regen scope

---

## Event log shape

### What does each `decision_events` row record?

| Option | Description | Selected |
|--------|-------------|----------|
| Full snapshot per event | Every event row contains complete decision state. Regeneration = take latest event. Simple, ~2× storage vs diff. | ✓ |
| JSON diff only | Each event stores changed fields; regeneration applies diffs in order. Smaller rows, load-bearing replay logic. | |
| Hybrid (status=snapshot, field edits=diff) | Best of both, more code. | |

**User's choice:** Full snapshot per event (recommended).
**Notes:** Greg-scale (~100 events/year) makes storage irrelevant; avoids diff-merge logic on the critical path.

### What triggers an event row?

| Option | Description | Selected |
|--------|-------------|----------|
| Every status transition AND field change | Literal reading of LIFE-02; captures all mutations. | ✓ |
| Status transitions only + `resolution`/`resolution_notes` writes | Other field edits (typo fixes) land directly on projection, no event. | |

**User's choice:** Every status transition and field change (recommended).
**Notes:** Literal LIFE-02 reading preserved.

---

## Legal transition map

### Can `open-draft` promote to `open`?

| Option | Description | Selected |
|--------|-------------|----------|
| open-draft → open allowed | Temporary holding pen; promotes when required fields filled. | ✓ |
| open-draft is terminal — must be withdrawn and re-captured | Cleaner audit trail but loses captured reasoning. | |

**User's choice:** `open-draft → open` allowed.

### How does a decision reach `stale`?

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit only — `due → stale` after 2 non-replies (RES-06) | Only auto-escalation transitions to stale. Deterministic. | ✓ |
| Also allow `open → stale` for long-abandoned decisions | Lets sweep move old rows to stale. More paths to reason about. | |

**User's choice:** Explicit only via RES-06.

### Can `withdrawn` be entered from any live state?

| Option | Description | Selected |
|--------|-------------|----------|
| From `open` / `open-draft` / `due` only | No retroactive withdrawal of resolved decisions. Audit integrity. | ✓ |
| From any non-terminal state including `resolved` | Unusual; probably wrong. | |

**User's choice:** Only from `open-draft` / `open` / `due`.

### `abandoned` vs `withdrawn`?

| Option | Description | Selected |
|--------|-------------|----------|
| Keep both — `withdrawn` explicit, `abandoned` = capture GC'd | Different semantics, different causes. | ✓ |
| Collapse both into `withdrawn` | Simpler enum, loses distinction. | |

**User's choice:** Keep both distinct.

---

## `decisions` column set

### How many reasoning slots?

| Option | Description | Selected |
|--------|-------------|----------|
| Single `reasoning` TEXT column | Matches M007 spec literally; simpler capture. | ✓ |
| `reasoning_stated` + optional `reasoning_suspected` | Research-surfaced; separates stated from tacit belief. | |

**User's choice:** Single `reasoning` column. Dual slots deferred to FUTURE.

### Include `domain_tag` in Phase 13?

| Option | Description | Selected |
|--------|-------------|----------|
| Include now — nullable text column | Avoids later migration; Phase 14 fills it, Phase 17 uses it. | ✓ |
| Defer to Phase 17 | Smaller Phase 13, later migration needed. | |

**User's choice:** Include now.

### Shape of `resolve_by`?

| Option | Description | Selected |
|--------|-------------|----------|
| `timestamp with time zone` NOT NULL | Matches Drizzle convention; SQL interval windows work natively. | ✓ |
| `date` NOT NULL | Day-only; breaks uniformity, adds casts. | |

**User's choice:** `timestamp with time zone NOT NULL`.

### Which optional fields exist on `decisions` in Phase 13? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| `resolution` + `resolution_notes` (text) | Phase 16 writes to these; add nullable now to avoid later migration. | ✓ |
| `accuracy_class` + `accuracy_classified_at` + `accuracy_model_version` | Phase 17 fills these; cached denormalization of classification event. | ✓ |
| `withdrawn_at`, `stale_at`, `abandoned_at` | Terminal-state timestamps; denormalized for fast queries. | ✓ |
| `language_at_capture` (varchar 3) | Phase 16 resolution prompt uses Greg's capture-time language (RES-02). | ✓ |

**User's choice:** All four. Note: STAT-02 cache lives on `decision_events` already (full-snapshot events); projection columns are denormalized mirror.

---

## Replay/regen scope

### How much of replay does Phase 13 deliver?

| Option | Description | Selected |
|--------|-------------|----------|
| Ship `regenerateDecisionFromEvents(id)` + roundtrip test | Proves append-only invariant at code level. | ✓ |
| Discipline only — no replay function yet | Smaller Phase 13; LIFE-02 claim untested. | |
| Ship replay + drift-check utility | Overkill at Greg-scale. | |

**User's choice:** Ship replay + roundtrip test.

### Error types?

| Option | Description | Selected |
|--------|-------------|----------|
| Two: `InvalidTransitionError` + `OptimisticConcurrencyError` | Phase 15 sweep retries on concurrency, gives up on invalid. Phase 18 TEST-11 needs distinction. | ✓ |
| One: `InvalidTransitionError` for both | Simpler; caller can't distinguish race from illegal move. | |

**User's choice:** Two distinct error types.

---

## Claude's Discretion

- Exact Drizzle column ordering and index strategy.
- Whether per-status CHECK constraints ship in Phase 13 or the phase that writes those fields (recommended: defer).
- Error class file location.
- Migration file naming / split.

## Deferred Ideas

- `reasoning_stated` + `reasoning_suspected` dual slots — FUTURE.
- Implicit `open → stale` sweep — rejected.
- Retroactive withdrawal of resolved decisions — rejected permanently.
- Drift-check utility — not needed at Greg-scale.
