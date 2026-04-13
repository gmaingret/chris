# Requirements: Project Chris

**Defined:** 2026-04-13
**Core Value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.

## v2.0 Requirements — M006 Trustworthy Chris

Requirements for milestone M006. Each maps to roadmap phases.

### Trust & Refusal Handling

- [ ] **TRUST-01**: Chris detects explicit refusals in EN/FR/RU via pattern matching (15-20 regex patterns per language)
- [ ] **TRUST-02**: Declined topics persist per-session and are injected into subsequent system prompts
- [ ] **TRUST-03**: Chris acknowledges a refusal once and never returns to the declined topic in the same conversation, even after intervening turns
- [ ] **TRUST-04**: Refusal handling rule is present in all 6 mode system prompts

### Anti-Sycophancy

- [ ] **SYCO-01**: Constitutional anti-sycophancy preamble is prefixed to all 6 modes via `buildSystemPrompt()`
- [ ] **SYCO-02**: The Hard Rule — Chris never tells Greg he is right because of who he is (no appeals to track record as evidence)
- [ ] **SYCO-03**: Three forbidden behaviors encoded as hard constraints: never resolve contradictions alone, never extrapolate to novel situations, never optimize for emotional satisfaction
- [ ] **SYCO-04**: Praise quarantine post-processor (Haiku) strips reflexive flattery from JOURNAL/REFLECT/PRODUCE responses
- [ ] **SYCO-05**: COACH and PSYCHOLOGY modes bypass praise quarantine (already forbid flattery at prompt level)

### Retrieval & Grounding

- [ ] **RETR-01**: JOURNAL mode uses hybrid retrieval (FACT/RELATIONSHIP/PREFERENCE/VALUE tags) before each Sonnet call
- [ ] **RETR-02**: Structured fact injection — stable facts extracted from FACT/RELATIONSHIP-tagged entries and injected as "Known Facts" key-value block
- [ ] **RETR-03**: Memory audit completed — all incorrect/outdated Pensieve entries about Greg reconciled against ground truth
- [ ] **RETR-04**: Chris says "I don't have any memories about that" for facts not in the Pensieve instead of confabulating

### Language & Conversation Quality

- [ ] **LANG-01**: Language detection via `franc` runs as engine pre-processing, not prompt rules
- [ ] **LANG-02**: Messages below 4 words or 15 characters inherit language of previous user message; default English if no prior
- [ ] **LANG-03**: Detected language passed as hard system parameter overriding statistical bias from conversation history
- [ ] **LANG-04**: Question-pressure reduced in JOURNAL prompt — questions are optional, Chris can simply respond

### Testing & Validation

- [ ] **TEST-01**: 3 live integration tests for refusal handling (EN/FR/RU), 3-of-3 passes
- [ ] **TEST-02**: 3 live tests for topic-decline persistence across 5+ intervening turns, 3-of-3 passes
- [ ] **TEST-03**: 3 live tests for JOURNAL grounding with seeded facts verified via Haiku follow-up, 3-of-3 passes
- [ ] **TEST-04**: 3 live tests for language switching EN/FR/RU verified via `franc` on response, 3-of-3 passes
- [ ] **TEST-05**: 3 live tests for sycophancy resistance to weak arguments, 3-of-3 passes
- [ ] **TEST-06**: 3 live tests for hallucination resistance (facts NOT in Pensieve), 3-of-3 passes
- [ ] **TEST-07**: 3 live tests for structured fact retrieval accuracy (seeded location/dates reported verbatim), 3-of-3 passes
- [ ] **TEST-08**: 3 live tests for performative apology detection (actually-different behavior after callout), 3-of-3 passes
- [ ] **TEST-09**: Contradiction false-positive audit — 20 adversarial non-contradictory pairs, 0 false positives

## Future Requirements

Deferred to subsequent milestones. Tracked but not in current roadmap.

### M007 — Decision Archive

- **DECI-01**: Decision capture protocol (5-question)
- **DECI-02**: Decision lifecycle state machine
- **DECI-03**: Forecast resolution scheduler

### M008 — Episodic Consolidation

- **EPIS-01**: Daily end-of-day summaries
- **EPIS-02**: Importance scoring
- **EPIS-03**: Recency-based retrieval routing

### M009 — Ritual Infrastructure (MVP)

- **RITU-01**: Daily voice note with rotating prompts
- **RITU-02**: Daily wellbeing snapshot (energy/mood/anxiety 1-5)
- **RITU-03**: Weekly review (observation + Socratic question + open slot)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Haiku-classified refusal detection | Pattern-based is cheap, deterministic, good enough (D020) |
| Profile layer changes | Deferred to M010-M012; requires real data from M009 |
| Decision archive | M007 scope — depends on M006 trust fixes |
| Ritual scheduling | M009 scope — depends on M007 and M008 |
| Multi-user support | Out of scope by design (D009) |
| Voice message transcription | Deferred — transcription error risk too high without review flow |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| RETR-03 | Phase 6 | Pending |
| TRUST-01 | Phase 7 | Pending |
| TRUST-02 | Phase 7 | Pending |
| TRUST-03 | Phase 7 | Pending |
| TRUST-04 | Phase 7 | Pending |
| SYCO-01 | Phase 7 | Pending |
| SYCO-02 | Phase 7 | Pending |
| SYCO-03 | Phase 7 | Pending |
| LANG-01 | Phase 7 | Pending |
| LANG-02 | Phase 7 | Pending |
| LANG-03 | Phase 7 | Pending |
| LANG-04 | Phase 7 | Pending |
| RETR-01 | Phase 8 | Pending |
| RETR-02 | Phase 8 | Pending |
| RETR-04 | Phase 8 | Pending |
| SYCO-04 | Phase 9 | Pending |
| SYCO-05 | Phase 9 | Pending |
| TEST-01 | Phase 10 | Pending |
| TEST-02 | Phase 10 | Pending |
| TEST-03 | Phase 10 | Pending |
| TEST-04 | Phase 10 | Pending |
| TEST-05 | Phase 10 | Pending |
| TEST-06 | Phase 10 | Pending |
| TEST-07 | Phase 10 | Pending |
| TEST-08 | Phase 10 | Pending |
| TEST-09 | Phase 10 | Pending |

**Coverage:**
- v2.0 requirements: 26 total
- Mapped to phases: 26
- Unmapped: 0

---
*Requirements defined: 2026-04-13*
*Last updated: 2026-04-13 after roadmap creation*
