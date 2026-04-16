# Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Integration Suite - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 18-synthetic-fixture-live-accountability-integration-suite
**Areas discussed:** Synthetic fixture design, ACCOUNTABILITY assertion strategy, Test file organization, Vague-prediction adversarial set

---

## Synthetic fixture design

### Database interaction

| Option | Description | Selected |
|--------|-------------|----------|
| Real DB + selective time injection | Use real Postgres, inject time via vi.setSystemTime rather than vi.useFakeTimers globally | ✓ |
| Real DB + vi.useFakeTimers with careful restoration | Use vi.useFakeTimers but restore real timers around DB calls | |
| Mocked DB + vi.useFakeTimers | Mock DB layer entirely (like deadline.test.ts) | |

**User's choice:** Real DB + selective time injection
**Notes:** Avoids timer conflicts with pg driver while proving real pipeline works.

### Fixture structure

| Option | Description | Selected |
|--------|-------------|----------|
| Single sequential test | One test walks through all 14 days step by step | ✓ |
| Staged describe blocks | Sequential it() blocks sharing state via closures | |
| You decide | Claude picks | |

**User's choice:** Single sequential test
**Notes:** Matches TEST-10 requirement for "a single fixture exercises..."

### LLM mocking

| Option | Description | Selected |
|--------|-------------|----------|
| Fully mocked LLM | Mock all Anthropic API calls with canned responses | ✓ |
| Real LLM calls | Use real Haiku/Sonnet | |
| You decide | Claude picks | |

**User's choice:** Fully mocked LLM
**Notes:** Fixture's purpose is proving time-based lifecycle, not LLM behavior.

### Clock injection mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Stub Date.now + vi.setSystemTime | Control Date.now() without faking setTimeout/setInterval | ✓ |
| Injectable getNow() function | Add thin wrapper in production code | |
| You decide | Claude picks | |

**User's choice:** Stub Date.now + vi.setSystemTime
**Notes:** Avoids breaking pg driver's async I/O while controlling time.

---

## ACCOUNTABILITY assertion strategy

### Assertion mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Haiku judge (Phase 10 pattern) | Follow-up Haiku classifies flattery (none/mild/strong) and condemnation (none/mild/strong) | ✓ |
| Keyword blocklist + Haiku fallback | Scan for markers first, escalate to Haiku if ambiguous | |
| Dual Haiku judge | Two separate Haiku calls for flattery and condemnation | |

**User's choice:** Haiku judge (Phase 10 pattern)
**Notes:** Matches D023 exactly — same mechanism proven in live-integration.test.ts.

### Scenario context

| Option | Description | Selected |
|--------|-------------|----------|
| Realistic personal decisions | Career change, renovation timeline, team adoption — emotional weight | ✓ |
| Abstract/neutral decisions | "Package will arrive by Tuesday" type | |
| You decide | Claude picks | |

**User's choice:** Realistic personal decisions
**Notes:** Tests that ACCOUNTABILITY tone holds when stakes are personal.

---

## Test file organization

### File layout

| Option | Description | Selected |
|--------|-------------|----------|
| 3 files by runtime requirement | synthetic-fixture.test.ts, live-accountability.test.ts, vague-validator-live.test.ts | ✓ |
| 5 files, one per requirement | Separate file for each TEST-10 through TEST-14 | |
| 2 files: synthetic vs live | Split along API-key boundary | |

**User's choice:** 3 files by runtime requirement
**Notes:** Groups by infrastructure needed: real DB + mocked LLM, real Sonnet, real Haiku.

### File location

| Option | Description | Selected |
|--------|-------------|----------|
| src/decisions/__tests__/ | Colocated with existing decisions tests | ✓ |
| src/chris/__tests__/ | Alongside Phase 10 live tests | |
| Split: decisions/ for synthetic, chris/ for live | Conceptual split | |

**User's choice:** src/decisions/__tests__/
**Notes:** All Phase 18 tests exercise the decisions subsystem.

---

## Vague-prediction adversarial set

### Language distribution

| Option | Description | Selected |
|--------|-------------|----------|
| Mixed: ~4 EN, 3 FR, 3 RU | Distributes across Greg's languages | ✓ |
| All English, separate language test | Focus on vagueness logic in one language | |
| You decide | Claude picks | |

**User's choice:** Mixed: ~4 EN, 3 FR, 3 RU
**Notes:** Tests vagueness detection in all three of Greg's languages.

### Adversarial style

| Option | Description | Selected |
|--------|-------------|----------|
| Hedged confidence | Sound specific but dodge falsifiability | ✓ |
| Outcome-ambiguous | Vague on what success means | |
| Mix of both + edge cases | Hedged + ambiguous + borderline valid | |
| You decide | Claude picks | |

**User's choice:** Hedged confidence
**Notes:** Hardest for validator to catch — mimics real predictions.

### Haiku usage

| Option | Description | Selected |
|--------|-------------|----------|
| Real Haiku | Proves the validator prompt actually works | ✓ |
| Mocked Haiku | Tests plumbing only | |
| Both: mocked unit + real integration | More thorough but potentially redundant | |

**User's choice:** Real Haiku
**Notes:** The entire point is proving the Haiku validator's prompt catches vague predictions.

---

## Claude's Discretion

- Exact mock response shapes for synthetic fixture
- Exact wording of 10 adversarial vague predictions
- Exact realistic personal decision scenarios for TEST-13
- Haiku judge prompt wording
- Timeout values, cleanup strategies, describe block organization

## Deferred Ideas

None — discussion stayed within phase scope.
