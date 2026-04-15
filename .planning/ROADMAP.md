# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** - Phases 1-5 (shipped 2026-04-13)
- 🚧 **v2.0 M006 Trustworthy Chris** - Phases 6-10 (in progress)

## Phases

<details>
<summary>v1.0 Phases 1-5 (SHIPPED)</summary>

- [x] **Phase 1: Foundation** - M001 Living Memory — Pensieve, 6-mode engine, Telegram bot
- [x] **Phase 2: Depth** - M002 Deep Counsel — 6-mode auto-detection, contradiction detection, hybrid retrieval
- [x] **Phase 3: External Sources** - M003 Digital Life — Gmail, Immich, Drive, file upload, cron sync
- [x] **Phase 4: Proactive Chris** - M004 — Proactive sweep with silence/commitment/pattern/thread triggers
- [x] **Phase 5: Requirement Validation** - M005 — All 28 v1.0 requirements resolved

</details>

### v2.0 M006 Trustworthy Chris

**Milestone Goal:** Fix four trust-breaking conversational failures (refusal ignoring, fact confabulation, performative apologies, question pressure) and harden Chris with constitutional anti-sycophancy + structured fact retrieval before soul-system work.

- [ ] **Phase 6: Memory Audit** - Reconcile Pensieve contents against ground truth before any code changes
- [ ] **Phase 7: Foundational Behavioral Fixes** - Constitutional preamble, refusal handling, language detection, question-pressure reduction
- [ ] **Phase 8: Retrieval & Grounding** - JOURNAL hybrid retrieval, structured fact injection, hallucination resistance
- [ ] **Phase 9: Praise Quarantine** - Haiku post-processor strips reflexive flattery from JOURNAL/REFLECT/PRODUCE
- [ ] **Phase 10: Live Validation Suite** - 24-case integration tests against real Sonnet + contradiction false-positive audit (re-opened 2026-04-14 — TEST-03 regression)
- [x] **Phase 11: Identity Grounding** - Unify persona identity so retrieved Greg-facts ground into first/second-person context (closes RETR-01/02/04, TEST-03 regression)

## Phase Details

### Phase 6: Memory Audit
**Goal**: Every fact Chris "knows" about Greg matches ground truth — no stale or incorrect entries remain in the Pensieve
**Depends on**: Phase 5 (M005 complete)
**Requirements**: RETR-03
**Success Criteria** (what must be TRUE):
  1. All Pensieve entries about Greg's location history, property, business entities, and key dates have been reviewed against documented ground truth
  2. Incorrect or outdated entries are corrected or annotated so they no longer surface as current facts
  3. A ground-truth reference document exists that subsequent phases can test against
**Plans:** 5 plans
Plans:
- [x] 06-01-PLAN.md — Ground-truth module and seed script with tests
- [x] 06-02-PLAN.md — Audit script, local validation cycle, and production run with D019 gate
- [x] 06-03-PLAN.md — Fix code review bugs (WR-01 match ordering, WR-02 null guard, WR-03 missing seed entry)
- [x] 06-04-PLAN.md — Local audit cycle execution against Docker Compose DB
- [x] 06-05-PLAN.md — Production dry-run review (D019 gate) and wet-run execution

### Phase 7: Foundational Behavioral Fixes
**Goal**: Chris respects refusals, matches Greg's language, stops interrogating in JOURNAL mode, and operates under a constitutional anti-sycophancy preamble across all 6 modes
**Depends on**: Phase 6
**Requirements**: TRUST-01, TRUST-02, TRUST-03, TRUST-04, SYCO-01, SYCO-02, SYCO-03, LANG-01, LANG-02, LANG-03, LANG-04
**Success Criteria** (what must be TRUE):
  1. When Greg says "I don't want to talk about that" in EN, FR, or RU, Chris acknowledges once and does not return to the topic for the rest of the conversation
  2. Chris responds in the same language Greg writes in, even when prior conversation history is in a different language
  3. In JOURNAL mode, Chris can respond naturally without ending every message with a question
  4. Chris pushes back on weak arguments instead of agreeing, and never appeals to Greg's track record as evidence for current claims
  5. The constitutional preamble and three forbidden behaviors are present in all 6 mode system prompts
**Plans**: TBD

### Phase 8: Retrieval & Grounding
**Goal**: JOURNAL mode grounds responses in structured Pensieve facts, and Chris explicitly declines to answer questions about facts not in the Pensieve rather than confabulating
**Depends on**: Phase 7
**Requirements**: RETR-01, RETR-02, RETR-04
**Success Criteria** (what must be TRUE):
  1. JOURNAL mode pulls FACT/RELATIONSHIP/PREFERENCE/VALUE-tagged entries before each Sonnet call (hybrid retrieval, not just conversation history)
  2. Stable facts (location, residency, dates, relationships) appear as a structured "Known Facts" key-value block in the system prompt, separate from narrative context
  3. When asked about a fact not in the Pensieve, Chris says it does not have that information instead of inventing an answer
  4. When asked about facts that ARE in the Pensieve (e.g., Greg's location, property), Chris reports them accurately without scrambling details
**Plans**: TBD

### Phase 9: Praise Quarantine
**Goal**: Chris never opens with reflexive praise in JOURNAL, REFLECT, or PRODUCE modes, while COACH and PSYCHOLOGY retain their existing direct style unchanged
**Depends on**: Phase 7 (preamble must exist)
**Requirements**: SYCO-04, SYCO-05
**Success Criteria** (what must be TRUE):
  1. JOURNAL, REFLECT, and PRODUCE responses do not contain reflexive flattery (e.g., "Great question!", "That's a really insightful observation")
  2. COACH and PSYCHOLOGY modes are unaffected by the praise quarantine post-processor
  3. The post-processor is a deterministic Haiku pass, not a prompt-only rule
**Plans**: TBD

### Phase 10: Live Validation Suite
**Goal**: Every behavioral fix in M006 is verified by live integration tests against real Sonnet, and contradiction detection is verified to produce zero false positives on adversarial non-contradictory pairs
**Depends on**: Phases 7, 8, 9 (all features must exist before integration testing)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09
**Success Criteria** (what must be TRUE):
  1. All 24 live integration test cases pass 3-of-3 against real Sonnet (refusal EN/FR/RU, topic persistence, JOURNAL grounding, language switching, sycophancy resistance, hallucination resistance, structured fact accuracy, performative apology detection)
  2. Contradiction false-positive audit passes: 20 adversarial non-contradictory pairs produce 0 false positives
  3. Test suite is reproducible and can be re-run to catch regressions in future milestones
**Plans:** 2/2 plans complete
Plans:
- [x] 10-01-PLAN.md — Live integration tests: refusal, language, topic persistence, sycophancy, performative apology (15 cases)
- [x] 10-02-PLAN.md — Live integration tests: grounding, hallucination, fact accuracy + contradiction false-positive audit (9 cases + 20 pairs)
**UI hint**: no

### Phase 11: Identity Grounding
**Goal**: Chris treats the Pensieve subject and the addressed user as a single identity ("Greg") so retrieved facts ground into first/second-person context instead of fracturing into a third-party "coincidence"
**Depends on**: Phase 10 (regression surfaced by live suite)
**Requirements**: RETR-01, RETR-02, RETR-04, TEST-03
**Gap Closure**: Closes gaps from v2.0-MILESTONE-AUDIT.md "Gap Re-opened — 2026-04-14"
**Success Criteria** (what must be TRUE):
  1. JOURNAL_SYSTEM_PROMPT addresses the user as "Greg" (or accepts a user-identity parameter); "John" no longer appears
  2. `buildKnownFactsBlock` frames facts as "Facts about you (Greg)" so the model does not split the subject into third-party
  3. Current-date injection is suppressed (or gated) in JOURNAL so responses do not fabricate prior-mention claims tied to today's date
  4. `live-integration.test.ts` TEST-03 (JOURNAL grounding) passes 3-of-3 on three consecutive clean runs
**Plans:** 3 plans
Plans:
- [ ] 11-01-PLAN.md — PensieveContextOptions + pre-staged identity test assertions
- [ ] 11-02-PLAN.md — Rename John→Greg across prompts/preamble/facts block + wire JOURNAL includeDate:false
- [ ] 11-03-PLAN.md — TEST-03 3-of-3 gate on three consecutive clean runs
**UI hint**: no

## Progress

**Execution Order:** 6 -> 7 -> 8 -> 9 -> 10 -> 11

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Foundation | v1.0 | - | Complete | - |
| 2. Depth | v1.0 | - | Complete | - |
| 3. External Sources | v1.0 | - | Complete | - |
| 4. Proactive Chris | v1.0 | - | Complete | - |
| 5. Requirement Validation | v1.0 | - | Complete | - |
| 6. Memory Audit | v2.0 M006 | 2/5 | In progress | - |
| 7. Foundational Behavioral Fixes | v2.0 M006 | 0/TBD | Not started | - |
| 8. Retrieval & Grounding | v2.0 M006 | 0/TBD | Not started | - |
| 9. Praise Quarantine | v2.0 M006 | 0/TBD | Not started | - |
| 10. Live Validation Suite | v2.0 M006 | 2/2 | Re-opened (TEST-03 regression 2026-04-14) | - |
| 11. Identity Grounding | v2.0 M006 | 0/3 | Planned | - |
