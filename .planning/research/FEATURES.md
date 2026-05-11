# Feature Research — M010 Operational Profiles

**Domain:** Situational-state inference + persistence layer for a single-user personal AI (Telegram bot, append-only Pensieve substrate, episodic memory tier)
**Researched:** 2026-05-11
**Confidence:** HIGH on profile dimension design and canonical observable fields (well-established in quantified-self, life-design, and personal finance domains); HIGH on dependency wiring (codebase is fully inspected); MEDIUM on confidence calibration mechanics (literature is thin on single-user personal AI; extrapolated from EMA and knowledge-graph precedents); LOW on weekly cadence frequency per dimension (no empirical precedent for this exact system — derived from first principles and Greg's observable event rate).

---

## Reading Guide

This research answers five categories of M010 questions:

1. **What operational profiles are** (concept, when useful, vs psychological profiles)
2. **What each of the 4 dimensions captures** (canonical fields, signal cadence, minimum threshold)
3. **How confidence scores work** (calibration model, update mechanics)
4. **What is table stakes vs differentiator vs anti-feature** (scope boundary for M010 vs M011/M013)
5. **How profiles wire into the existing M001–M009 substrate** (exact read APIs, integration points)

---

## 1 — What "Operational Profile" Means

### 1.1 Operational vs Psychological (the conceptual boundary)

An **operational profile** answers: *"What is this person's current situational state, derived from observable facts?"*

A **psychological profile** (M011 HEXACO, deferred) answers: *"What are this person's enduring dispositional traits, inferred from behavioral patterns over time?"*

The distinction matters architecturally:

| Dimension | Operational | Psychological |
|-----------|-------------|---------------|
| Update cadence | Days to weeks (events happen) | Months (dispositions shift slowly) |
| Ground-truth availability | HIGH — a country is a country | MEDIUM — a trait is a construct |
| Falsifiability | Direct ("you said France, now you say Georgia — update") | Indirect ("your behavior cluster shifted toward X") |
| Minimum data threshold | 10 entries with observable facts | 2,000 words of behavioral speech (D028 ATTACH-01 precedent) |
| What triggers an update | A declared or inferred event | A statistically significant pattern shift |
| Risk of over-inference | LOW | HIGH |

For a user-facing AI, operational profiles are valuable when:
- The AI needs to give context-grounded answers without Greg re-stating his situation every session
- The AI needs to avoid anachronistic responses (e.g., recommending French tax strategy after Greg has moved to Georgia)
- The AI needs to detect profile-inconsistent advice before delivering it

The Chris PRD describes exactly this: the profile layer serves as "grounded context" injected into REFLECT/COACH/PSYCHOLOGY system prompts so the AI does not treat Greg as a blank slate in every conversation. Without operational profiles, COACH might recommend "open a French bank account" three months after Greg has established Georgian residency.

### 1.2 When operational profiles become useful (the minimum useful state)

Profiles are useful the moment they have a single confirmed fact per dimension. A jurisdictional profile with one entry — "currently in Batumi, Georgian residency in progress" — is already more useful than no profile. Confidence starts low (0.2–0.3) and rises as entries accumulate and converge.

The M010 spec's "10 entry minimum before populating" is the right floor for **not** generating a profile that misleads more than it helps. Below 10 entries, the AI should surface "insufficient data" rather than a possibly-wrong profile.

---

## 2 — Canonical Observable Fields Per Dimension

### 2.1 Jurisdictional Profile

**What it answers:** Where is Greg physically and legally situated?

**Canonical observable facts to extract** (from Pensieve entries tagged FACT/INTENTION, episodic summaries, M007 decisions):

| Field | What to look for in entries | Signal cadence | Notes |
|-------|----------------------------|----------------|-------|
| `current_country` | "I'm in X", "arrived in X", travel mentions | 0–2 events/week | Changes ~4x/year given Greg's move pattern |
| `physical_location` | City, neighborhood mentions | 0–3/week | Finer grain than country |
| `residency_status` | Permit mentions, visa mentions, residency application status | 0–1/month | Sparse but high-signal |
| `tax_residency` | Tax discussions, "tax resident of X" | 0–1/quarter | Very sparse; must persist when seen |
| `active_legal_entities` | Business entity mentions (LLC, IE, etc.) | 0–1/month | MAINGRET LLC, Georgian IE already in ground-truth |
| `next_planned_move` | "I plan to move to X in Y", "leaving in Z weeks" | 0–2/week leading up to move | Intention-tagged entries |
| `planned_move_date` | Date mentioned alongside move intention | 0–1/event | Extract from INTENTION entries |
| `passport_citizenships` | Nationality declarations | ~never (stable) | French national — from ground-truth |

**From Greg's actual ground-truth** (already in `src/pensieve/ground-truth.ts`):
- French national, born Cagnes-sur-Mer
- Saint Petersburg Russia → Batumi Georgia (April 2026) → Antibes France (June–August 2026) → Batumi permanent (~September 2026)
- Panama permanent residency
- MAINGRET LLC (New Mexico), Georgian Individual Entrepreneur

This ground-truth is already partially a jurisdictional profile. M010 makes it dynamic: the profile tracks the current state and updates as Greg's situation evolves, rather than requiring a code change to `ground-truth.ts`.

**Minimum signal needed before updating:** Any single FACT or INTENTION entry that mentions a location change, permit, or legal entity. One entry with "arrived in Batumi" is sufficient to update `current_country` to Georgia (confidence low, maybe 0.3). Three convergent entries over one week raises it to 0.7.

### 2.2 Capital Profile

**What it answers:** Where is Greg in his financial independence journey, and what is his sequencing?

**Canonical observable facts:**

| Field | What to look for | Signal cadence | Notes |
|-------|-----------------|----------------|-------|
| `fi_phase` | "post-FI", "accumulation", "decumulation", explicit net worth discussions | 0–1/week | Greg is post-FI per ground-truth ($1.5M target mentioned) |
| `fi_target_amount` | Explicit dollar/euro amount | ~never (locked unless revised) | $1,500,000 already in ground-truth |
| `estimated_net_worth` | Net worth mentions, portfolio discussions | 0–1/month | Nullable; only populate if Greg states a figure |
| `runway_months` | "X months of runway", "living off savings for Y" | 0–1/month | Operationally important for Batumi timing |
| `next_sequencing_decision` | "deciding whether to...", financial next-steps | 0–2/week | Highest-value field for COACH context |
| `income_sources` | Business income, rental income, investment income mentions | 0–2/week | Golfe-Juan rental (Citya), business revenue |
| `major_allocation_decisions` | Large investment moves, asset rebalancing | 0–1/month | Often appears as M007 decisions |
| `tax_optimization_status` | Georgian 1% regime, French obligations, US LLC pass-through | 0–1/month | Cross-references jurisdictional profile |

**Why this dimension exists:** COACH mode frequently gives financial advice. Without the capital profile, COACH has no way to know whether Greg is in accumulation, early FI, or late FI with a draw-down plan. Recommending "grow the business" when Greg is actively trying to reduce work to enjoy FI would be wrong. The profile gives COACH the framing: "Greg is post-FI, building runway for the Batumi permanent relocation — capital advice should optimize for tax efficiency and lifestyle sustainability, not wealth growth."

**Minimum signal needed:** A single entry stating net worth, runway, or FI phase is enough to seed the profile. The FI target is already in ground-truth and should seed the initial profile at boot time.

### 2.3 Health Profile

**What it answers:** What is Greg's current clinical picture — ongoing investigations, treatments, hypotheses?

This dimension differs from the others because it operates as a **running case file**, not a snapshot. Medical situations have:
- Open hypotheses (suspected conditions being investigated)
- Pending tests (scheduled blood work, scans, consultations)
- Active treatments (medications, protocols, lifestyle interventions)
- Resolved events (past investigations that closed)
- Subjective symptom reports (from Pensieve + wellbeing snapshots)

**Canonical observable facts:**

| Field | What to look for | Signal cadence | Notes |
|-------|-----------------|----------------|-------|
| `open_hypotheses` (jsonb array) | "they think it might be X", "being tested for Y", "suspect Z" | 0–3/week during active investigation | Each hypothesis has: name, status (investigating/confirmed/ruled_out), date_opened |
| `pending_tests` (jsonb array) | "blood test next week", "MRI scheduled", "waiting on results for" | 0–2/week | Each has: test_name, scheduled_date, status |
| `active_treatments` (jsonb array) | "taking X", "started protocol Y", "doctor prescribed Z" | 0–1/week | Each has: name, started_date, purpose |
| `recent_resolved` (jsonb array) | "results came back negative", "ruled out X" | 0–1/month | Keep last 90 days for context |
| `case_file_narrative` (text) | Sonnet-assembled narrative from the above | updated with each profile refresh | Plain text, interpretive summary, D031 boundary: this is interpretation |
| `wellbeing_trend` | Pull from `wellbeing_snapshots` — 30-day rolling means | continuous | Anchors the health profile in numeric series |

**Why the case-file model instead of a snapshot model:** Medical situations are stateful and sequential. "Open hypothesis: sleep apnea" is not a momentary observation — it persists until explicitly resolved. The profile must track which hypotheses are open, which tests are scheduled, and which have resolved. Losing that state between weekly updates would mean the AI loses the thread of an ongoing health investigation.

**Key data source beyond Pensieve:** The M009 wellbeing snapshots (energy/mood/anxiety 1–5) become a quantified substrate for health inference. If Greg's energy has been 1–2 for three weeks, that is a data point for the health profile even if he has not mentioned a specific condition.

**Minimum signal needed:** Any FACT entry mentioning a symptom, test, diagnosis, or treatment. Health is a low-volume dimension (0–3 relevant entries/week) but each entry is high-signal.

### 2.4 Family Profile

**What it answers:** Where is Greg in the family formation arc — partnership criteria, children plans, parent-care trajectory, relationship status?

**Canonical observable facts:**

| Field | What to look for | Signal cadence | Notes |
|-------|-----------------|----------------|-------|
| `relationship_status` | "dating X", "met someone", "single", "seeing someone" | 0–1/month | Changes rarely; high salience when it does |
| `partnership_criteria_evolution` (jsonb array) | "I've realized I need X in a partner", "no longer care about Y", "important to me now: Z" | 0–2/week when actively processing | Each criterion has: text, date_noted, still_active |
| `children_plans` | "I want kids", "no kids for now", "thinking about this more", timeline statements | 0–1/month | May be dormant; surface when mentioned |
| `parent_care_responsibilities` (jsonb) | "my parents need X", "handling care for Y", dependency mentions | 0–1/month | Affects financial + jurisdictional planning |
| `active_dating_context` (text) | Sonnet-assembled current context: where is Greg looking, what channels, recent experiences | 0–2/week when active | Interprets RELATIONSHIP-tagged entries |
| `milestones` (jsonb array) | First date, relationship transitions, breakups, proposals | ~event-driven | Each milestone: type, date, notes |
| `constraints` (jsonb array) | "must speak X language", "must be open to living in Y", "age range Z" | 0–1/month when actively defining | Derived from explicit declarations |

**Why PSYCHOLOGY mode especially needs this:** Psychological analysis of Greg's behavior patterns in relationships requires knowing where he actually is in the family formation arc. Without this, PSYCHOLOGY might surface attachment-theory observations that are disconnected from Greg's actual situation. A "currently single and actively looking" context produces different psychological grounding than "in a committed 2-year relationship."

**Minimum signal needed:** Any RELATIONSHIP or FACT entry mentioning a person Greg is romantically interested in, partnership criteria, or family plans. This dimension may have very sparse signal for weeks if Greg is not actively processing family formation topics.

---

## 3 — Weekly Update Cycle and Confidence Calibration

### 3.1 What the weekly update actually does

Each Sunday, a cron job runs **after** the M008 episodic consolidation cron (23:00) — so at earliest Monday 00:01 or at a separate scheduled time. It:

1. Calls `getEpisodicSummariesRange(weekStart, weekEnd)` — the same function M009 weekly review uses
2. Queries `pensieve_entries WHERE epistemic_tag IN ('FACT','INTENTION','RELATIONSHIP','EXPERIENCE') AND created_at >= weekStart`
3. For each of the 4 profiles, runs a **focused Sonnet prompt** (one per profile, never a mega-prompt) that extracts structured updates from that week's signals
4. Merges the new signals with the existing profile row, updating fields that changed and bumping confidence where evidence is convergent
5. Updates `last_updated` and `confidence` on the profile row

**Signal cadence reality check per dimension:**

| Dimension | Typical events/week | Signal density | Implication |
|-----------|--------------------|--------------------|-------------|
| Jurisdictional | 0–2 (travel, permit updates) | LOW most weeks, HIGH during moves | Profile is stable for weeks; update mostly no-op |
| Capital | 1–3 (financial discussions, decisions) | LOW-MEDIUM | Updates ~bi-weekly in practice |
| Health | 0–3 (active investigation periods) vs 0 (quiet periods) | Bursty | Profile may not update for weeks then burst |
| Family | 0–2 (relationship processing) | LOW normally, MEDIUM when actively processing | Similar bursty pattern to health |

**The no-op case is normal and expected.** Most weeks, 2–3 of the 4 profiles will not update because no relevant signals appeared. The cron runs weekly regardless and notes "no new signals" without changing the profile row (last_updated is not bumped on no-op; only bump when something actually changes).

### 3.2 Confidence score calibration

Confidence represents: *"How confident is Chris that this profile accurately reflects Greg's current state?"*

**Calibration model** (derived from EMA/knowledge-graph literature and first principles):

```
confidence = clamp(volume_score × consistency_score × recency_score, 0.0, 1.0)

volume_score     = min(entry_count / 30, 1.0)        // saturates at 30 confirmed entries
consistency_score = 1 - (contradictions / total)      // proportion of non-contradictory signals
recency_score    = exp(-decay_rate × days_since_last_update)  // decay_rate ~0.02 → halves in 35 days
```

**Practical calibration:**
- Below 10 entries: confidence = 0, profile shows "insufficient data" (M010 spec requirement)
- 10–20 entries with high consistency: confidence 0.4–0.6
- 20–40 entries with high consistency: confidence 0.6–0.8
- 40+ entries with very high consistency and recent activity: confidence 0.8–1.0

**Decay is important:** If Greg has not mentioned his jurisdictional status for 6 weeks, confidence should drift downward slightly. A 35-day half-life on the recency component means a profile last updated 70 days ago has its confidence halved from recency alone. This prevents the system from presenting stale data with false certainty.

**Contradictions reduce confidence:** If Greg says "planning to move in June" in week 1 and "no longer planning that move" in week 3, the contradiction reduces consistency_score. Chris should surface the contradiction (per D006 contradiction detection) rather than silently picking one version.

**What gets stored with confidence:**
- The profile row stores `confidence` as a float 0.0–1.0
- The weekly Sonnet prompt produces a structured JSON update that includes `confidence_delta` per field (e.g., `{current_country: +0.2, next_planned_move: -0.1}` because the move date became uncertain)
- Chris stores only the aggregate `confidence` value on the profile row; per-field confidence is computed at prompt time from the profile data, not persisted separately (too granular for M010)

---

## 4 — Feature Landscape

### Table Stakes (M010 must-have)

| # | Feature | Why Expected | Complexity | Dependency | Notes |
|---|---------|--------------|------------|------------|-------|
| TS-1 | Four Drizzle tables: `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family` | Schema foundation; everything else reads/writes here | LOW (DDL + migration) | None beyond existing schema | Each table: id, last_updated, confidence (0–1), profile-specific jsonb cols per M010 spec |
| TS-2 | `getOperationalProfiles()` in `src/memory/profiles.ts` | Profiles are useless without a read API | LOW (Drizzle select × 4) | TS-1 | Returns structured data, NOT narrative summary (D035 boundary) |
| TS-3 | Weekly cron: one focused Sonnet prompt per profile from prior week's episodic + tagged Pensieve entries | The inference engine itself | HIGH (prompt engineering × 4, structured output, merge logic) | M008 `getEpisodicSummariesRange`, M009 `wellbeing_snapshots` | Never a mega-prompt; 4 separate Sonnet calls |
| TS-4 | 10-entry minimum threshold enforcement before populating any profile | Prevents wrong inference from sparse data (D028 precedent) | LOW | TS-1 | Below threshold: row exists, all fields = null/"insufficient data", confidence = 0 |
| TS-5 | Confidence score on each profile row (float 0.0–1.0) | Without confidence, Greg cannot calibrate trust | LOW | TS-3 | Volume × consistency × recency model; updated by weekly cron |
| TS-6 | REFLECT, COACH, PSYCHOLOGY mode handlers call `getOperationalProfiles()` and inject into system prompt | The reason profiles exist: grounded context for the three synthesis modes | MEDIUM (injection point in each handler) | TS-2, existing mode handlers | System prompt injection, not tool call result; structured key-value block mirroring D031 Known Facts pattern |
| TS-7 | `/profile` Telegram command — read-only formatted output of all 4 profiles with confidence ranges | Greg's ability to see + audit his own profiles | MEDIUM (formatter) | TS-2 | Psychological profiles section shows "not yet available — see M011" until M011 lands |
| TS-8 | Below-threshold case: `/profile` returns "Insufficient data" + confidence=0 for each dimension | Spec requirement; prevents Chris from making up data | LOW | TS-4 | The sparse-fixture test drives this |
| TS-9 | Synthetic fixture test (30+ days, all 4 dimensions) | D041 convention — no milestone may gate on real calendar time | HIGH (fixture design) | Primed-fixture pipeline (v2.3), `loadPrimedFixture` | Parallel fixture: 30-day populated; 5-entry sparse. Both must pass |
| TS-10 | Sparse-fixture test: 5-entry fixture → confidence=0, "insufficient data" on all 4 | The threshold enforcement proof | MEDIUM | TS-9 | Must run against real Postgres (real-DB integration test) |
| TS-11 | D035 boundary: profiles module never reads from `episodic_summaries` directly into profile narrative fields | Summaries are interpretation; profile narrative is a separate Sonnet-assembled field | LOW (architecture constraint) | D035 | `boundary-audit.test.ts` may need extension |
| TS-12 | Never-throw contract on `getOperationalProfiles()` | Consistent with existing retrieve.ts / ground-truth.ts conventions (D005) | LOW | TS-2 | Returns null/empty array per profile on any DB error; logs at warn |

### Differentiators (v2.5.1 or M013 — not M010)

| # | Feature | Value Proposition | Complexity | When to Add |
|---|---------|-------------------|------------|-------------|
| DIFF-1 | Multi-profile cross-reference reasoning (e.g., "you're in a low-tax-residency window — does that affect FI sequencing?") | The most valuable synthesis: profiles inform each other | HIGH | M013 — needs all 4 operational + M011 psychological profiles to be mature |
| DIFF-2 | Auto-detection of profile-change moments (e.g., "you just mentioned a residency change — should I bump the jurisdictional profile now?") | Real-time profile maintenance vs weekly batch | MEDIUM | v2.5.1 — needs empirical data on how often Greg's profile changes to calibrate the false-positive rate |
| DIFF-3 | Time-series profile history (snapshots over time, not just current state) | Lets Chris say "your capital profile 6 months ago was X; now it's Y — here's what changed" | MEDIUM | M013 or M014 — current-state-only is the right starting point |
| DIFF-4 | Per-profile narrative summary (Sonnet-generated plain-text paragraph per dimension) | Richer `/profile` output than structured fields | LOW-MEDIUM | v2.5.1 — `case_file_narrative` in health profile is the seed; extend to all 4 |
| DIFF-5 | Profile consistency checker (detect when Pensieve entries contradict the stored profile; surface for correction) | Keeps profiles honest over time | MEDIUM | v2.5.1 — extend contradiction detection (M002) to include profile fields |
| DIFF-6 | Wellbeing-anchored health profile updates (detect when sustained low energy/mood/anxiety trends drive a health profile update independent of explicit Pensieve mentions) | Closes the loop between quantitative wellbeing series and qualitative health hypothesis tracking | MEDIUM | v2.5.1 — requires 30+ days of wellbeing data to calibrate thresholds |
| DIFF-7 | Per-field confidence (not just aggregate confidence per profile) | More granular trust signaling (e.g., "current_country: HIGH confidence; next_planned_move: LOW confidence") | MEDIUM | M013 — aggregate confidence is sufficient for M010 |

### Anti-Features (explicit exclusions — do not build in M010 or later)

| # | Feature | Why Requested | Why Excluded | Alternative |
|---|---------|---------------|--------------|-------------|
| ANTI-1 | Predictive future-state forecasting from profiles ("based on your profile, you'll likely...") | Seems like a natural profile extension | Out of scope per M010 spec; Chris does not predict Greg's future; that's astrology not profile management | Socratic questioning via COACH if Greg wants to reason about futures |
| ANTI-2 | Multi-user profile sharing or federation | Extension of the platform | Single-user app (D009); multi-tenancy is explicitly out of scope in PLAN.md | N/A |
| ANTI-3 | Profile visualization (charts, dashboards, timeline views) | Richer UX | Telegram text-only (no frontend); D009 single-user | `/profile` text output is the read interface |
| ANTI-4 | Real-time profile update on every message (inline update vs weekly batch) | Feels more responsive | Adds inference cost to every message; profile stability matters (a single sentence should not flip a profile field) | Weekly batch cron is the right cadence; DIFF-2 is the escape valve for high-salience events |
| ANTI-5 | Psychological trait inference from operational profile fields | "Post-FI person = lower financial anxiety" | Mixes operational and psychological tiers; M011 handles trait inference | M011 HEXACO profiles consume the same episodic substrate independently |
| ANTI-6 | Profile editing by Greg via Telegram commands (/profile edit jurisdictional current_country=Georgia) | Explicit correction capability | Opens a command-parsing surface; profiles should be inference-derived, not manually maintained | Greg corrects profiles by depositing new Pensieve entries; the weekly update picks up the correction naturally |
| ANTI-7 | Separate "profile mode" in the 6-mode engine | User-facing profile management | Profiles are context, not conversation; exposing them as a mode confuses the interaction model | `/profile` command for read; weekly inference for write |

---

## 5 — Feature Dependencies

```
M008 getEpisodicSummariesRange ──┐
M009 wellbeing_snapshots ─────────┤
                                  ├──> TS-3 weekly profile update cron
M009 pensieve_entries filter      │         (one Sonnet prompt per profile)
(FACT/INTENTION/RELATIONSHIP/     │
 EXPERIENCE tags) ────────────────┘
                                        │
                                        v
                                  TS-1 profile tables (Drizzle)
                                        │
                                        v
                                  TS-2 getOperationalProfiles()
                                  (src/memory/profiles.ts)
                                    │              │
                          ┌─────────┘              └──────────┐
                          v                                   v
                  TS-6 inject into                     TS-7 /profile
                  REFLECT/COACH/PSYCHOLOGY              command
                  system prompts                       (text-only read)
                  (buildSystemPrompt() extension)

M002 epistemic tagger ──> tags = FACT/INTENTION/RELATIONSHIP/EXPERIENCE
                          are the input filter for TS-3

M007 decisions ──> resolved decisions supplement capital profile
                   (major financial decisions as high-signal capital events)

Ground truth (src/pensieve/ground-truth.ts) ──> seeds initial
                   jurisdictional + capital profiles at migration time
                   (avoids confidence=0 on day 1 for known facts)

D041 primed-fixture pipeline ──> TS-9 30-day synthetic fixture
                                 TS-10 5-entry sparse fixture
```

### Dependency Notes

- **TS-3 requires M008 `getEpisodicSummariesRange`:** This function is already exported from `src/pensieve/retrieve.ts` and is the first production consumer of M008's range query capability. M009 weekly review also uses it — M010 is the second production consumer. No new substrate needed.

- **TS-3 requires M009 wellbeing_snapshots:** The wellbeing_snapshots table ships in M009 Phase 27 (WELL-01). M010 cron can query it directly via Drizzle for the health profile's `wellbeing_trend` field.

- **TS-6 requires extending `buildSystemPrompt()` in `src/chris/personality.ts`:** The function signature currently takes `(mode, pensieveContext, relationalContext, language, declinedTopics)`. Profiles add a new parameter: `operationalProfileContext?: string`. Alternatively, profiles are appended to `relationalContext` block for REFLECT/COACH/PSYCHOLOGY (which already receive `relationalContext`) — this avoids signature churn. The structured profile block goes above the `## Relational Memory` section in those modes' system prompts.

- **TS-6 integration point is system-prompt injection, not a tool call or separate pre-prompt:** This matches the existing KNOWN FACTS block pattern (D031). Profiles are formatted as a structured key-value block labeled `## Operational Profile (grounded context — not interpretation)` and injected before `{pensieveContext}` in the mode handler, not via the Anthropic API's tool-use feature. Tool-use would add latency and complexity; a system-prompt block is free and consistent with the existing architecture.

- **TS-9/TS-10 synthetic fixtures must be new, not reusing m009-21days:** The M010 fixture needs 30+ days with profile-relevant entries (location changes, capital discussions, health events, family mentions). The existing m009-21days fixture is optimized for ritual behavior testing. A separate `m010-30days` primed fixture is needed.

- **Ground-truth seeding:** `src/pensieve/ground-truth.ts` already contains 13 facts that are effectively jurisdictional + capital profile data (nationality, location history, business entities, FI target). M010 should seed the initial profile rows from these facts at migration time, giving Greg a non-zero starting point with low confidence (0.2–0.3) on day 1 rather than "insufficient data" for facts Chris already knows.

---

## 6 — Expected Behavior (Concrete /profile Output Examples)

### 6.1 Populated profiles (30+ days, high engagement)

```
/profile

Jurisdictional (confidence 0.82)
Last updated: 2026-05-10

Current location: Batumi, Georgia (since April 2026)
Physical location: Batumi city center
Residency status: Georgian residency application in progress (filed April 2026)
Tax residency: France (2025 fiscal year); Georgia target for 2026 fiscal year
Active entities: MAINGRET LLC (New Mexico, active); Georgian Individual Entrepreneur (active)
Next planned move: Antibes, France — June 2026 (3-month summer stay, not residency change)
Permanent relocation: Batumi, Georgia — September 2026 (confirmed intention, 3 supporting entries)
Passports/citizenships: French national

Capital (confidence 0.65)
Last updated: 2026-05-09

FI phase: Post-FI (target reached or near; lifestyle optimization phase)
FI target: $1,500,000
Estimated net worth: Not stated (Greg has not confirmed a figure)
Current runway: ~18 months of lifestyle costs (inferred from 2 entries; low confidence on this figure)
Income sources: Golfe-Juan rental (Citya); MAINGRET LLC (US business income); Georgian IE
Next sequencing decision: Georgian tax residency establishment timeline
Tax optimization: Georgian 1% small business regime planned for 2026; French tax obligations through 2025

Health (confidence 0.43)
Last updated: 2026-05-03

Open hypotheses: [none confirmed this week]
Pending tests: [none mentioned]
Active treatments: [none mentioned]
Wellbeing trend (30-day): Energy avg 2.9/5 (declining); Mood avg 3.4/5 (stable); Anxiety avg 3.1/5 (slight uptick last 2 weeks)
Case file narrative: No active medical investigations this period. Sustained low energy pattern in wellbeing data warrants monitoring — may reflect move-related stress or physical adjustment to climate change.

Family (confidence 0.31)
Last updated: 2026-04-27

Relationship status: Not specified (no recent entries)
Children plans: Not specified
Parent-care responsibilities: Not mentioned
Partnership criteria (recent updates):
  - [2026-04-21] "needs to be comfortable with nomadic lifestyle and frequent moves"
  - [2026-04-15] "intellectual compatibility is non-negotiable"
Active context: No current relationship activity mentioned. Criteria evolution ongoing.

Psychological profiles: not yet available — see M011 (planned for v2.6)
```

### 6.2 Sparse fixture — below threshold

```
/profile

Insufficient data — 5 entries across all dimensions (minimum 10 required per dimension).

Jurisdictional: insufficient data (confidence 0.0) — 2 relevant entries found
Capital: insufficient data (confidence 0.0) — 1 relevant entry found
Health: insufficient data (confidence 0.0) — 1 relevant entry found
Family: insufficient data (confidence 0.0) — 1 relevant entry found

Chris will update profiles automatically as more entries accumulate. No action needed.

Psychological profiles: not yet available — see M011 (planned for v2.6)
```

Note: The ground-truth seeding means in practice Greg will never see the sparse-fixture output on a fresh install — the 13 ground-truth facts seed the jurisdictional and capital profiles immediately. The sparse-fixture test validates the threshold enforcement logic for cold-start protection and edge cases.

---

## 7 — MVP Definition

### Launch with v2.5 M010 (must-have)

- [x] TS-1 Four Drizzle profile tables with migration
- [x] TS-2 `getOperationalProfiles()` in `src/memory/profiles.ts`
- [x] TS-3 Weekly cron: 4 focused Sonnet prompts, structured output, merge logic
- [x] TS-4 10-entry minimum threshold enforcement
- [x] TS-5 Confidence score per profile (volume × consistency × recency model)
- [x] TS-6 REFLECT, COACH, PSYCHOLOGY system prompt injection
- [x] TS-7 `/profile` Telegram command with text-only formatted output
- [x] TS-8 Below-threshold: "insufficient data" + confidence=0
- [x] TS-9 30-day synthetic fixture covering all 4 dimensions
- [x] TS-10 5-entry sparse fixture threshold enforcement test
- [x] TS-11 D035 boundary: profiles module separate from episodic narrative
- [x] TS-12 Never-throw contract on `getOperationalProfiles()`

### Add after validation (v2.5.1)

- [ ] DIFF-2 Auto-detection of profile-change moments — after empirical data on false-positive rate
- [ ] DIFF-4 Per-profile narrative summary (extend `case_file_narrative` to all 4 dimensions)
- [ ] DIFF-5 Profile consistency checker — extend M002 contradiction detection
- [ ] DIFF-6 Wellbeing-anchored health profile updates

### Future consideration (M013 or M014)

- [ ] DIFF-1 Multi-profile cross-reference reasoning — after all operational + psychological profiles are mature
- [ ] DIFF-3 Time-series profile history
- [ ] DIFF-7 Per-field confidence granularity

---

## 8 — Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| TS-1 four profile tables | HIGH (foundation) | LOW | P1 |
| TS-2 getOperationalProfiles() | HIGH | LOW | P1 |
| TS-3 weekly cron (4 Sonnet prompts) | HIGH | HIGH | P1 |
| TS-4 10-entry threshold | HIGH (trust) | LOW | P1 |
| TS-5 confidence score | MEDIUM | LOW | P1 |
| TS-6 mode handler injection | HIGH | MEDIUM | P1 |
| TS-7 /profile command | HIGH (auditability) | MEDIUM | P1 |
| TS-8 sparse → insufficient data | HIGH (correctness) | LOW | P1 |
| TS-9 30-day synthetic fixture | HIGH (D041 gate) | HIGH | P1 |
| TS-10 sparse fixture test | MEDIUM (threshold proof) | MEDIUM | P1 |
| TS-11 D035 boundary | MEDIUM (architecture) | LOW | P1 |
| TS-12 never-throw contract | MEDIUM (stability) | LOW | P1 |
| DIFF-2 auto change detection | MEDIUM | MEDIUM | P2 |
| DIFF-4 narrative summary | MEDIUM | LOW-MEDIUM | P2 |
| DIFF-5 profile consistency | MEDIUM | MEDIUM | P2 |
| DIFF-6 wellbeing health anchor | LOW-MEDIUM | MEDIUM | P2 |
| DIFF-1 cross-profile reasoning | HIGH (long-term) | HIGH | P3 |
| DIFF-3 time-series history | MEDIUM | MEDIUM | P3 |
| DIFF-7 per-field confidence | LOW (over-engineering) | MEDIUM | P3 |
| ANTI-1..7 | n/a | n/a | OUT OF SCOPE |

**Priority key:** P1 = must have for M010 launch; P2 = v2.5.1 after empirical data; P3 = M013+

---

## 9 — Complexity Classification Per Feature

| Feature | Classification | Reason |
|---------|---------------|--------|
| TS-1 schema + migration | TRIVIAL | Standard Drizzle DDL; precedent from 9 prior migrations |
| TS-2 getOperationalProfiles() | TRIVIAL | 4 Drizzle selects + null handling |
| TS-3 weekly profile update cron | COMPLEX | 4 separate Sonnet prompts with structured output parsing; merge logic; idempotency; threshold enforcement; confidence calculation |
| TS-4 threshold enforcement | TRIVIAL | Count query before populating |
| TS-5 confidence score | MODERATE | Volume × consistency × recency formula; storing the result; decay logic |
| TS-6 mode injection | MODERATE | Extend `buildSystemPrompt()` or mode handlers × 3; format profile block; integrate with existing context builder |
| TS-7 /profile command | MODERATE | Formatter for 4 profiles + confidence display; grammatically coherent text output; M011 placeholder section |
| TS-8 sparse case | TRIVIAL | Conditional on confidence=0 in formatter |
| TS-9 30-day fixture | COMPLEX | Fixture must cover all 4 profile dimensions with realistic entry patterns; primed-fixture pipeline extension |
| TS-10 sparse fixture test | MODERATE | New fixture variant; real-DB integration test |
| TS-11 D035 boundary | TRIVIAL | Architecture constraint; boundary-audit.test.ts extension |
| TS-12 never-throw | TRIVIAL | try/catch wrapper pattern already established |

**The complex item is TS-3** — the weekly profile update cron. This is where the prompt engineering, structured-output parsing, confidence calibration, and merge logic all live. It should be implemented as a dedicated phase and tested with the synthetic fixture before the mode-injection phase.

---

## Sources

**Codebase (fully inspected):**
- `src/pensieve/retrieve.ts` — `getEpisodicSummariesRange`, `hybridSearch`, `getTemporalPensieve` APIs
- `src/pensieve/routing.ts` — `retrieveContext`, `summaryToSearchResult`
- `src/pensieve/ground-truth.ts` — 13 existing ground-truth facts (jurisdictional + capital seeds)
- `src/chris/personality.ts` — `buildSystemPrompt()` signature; `CONSTITUTIONAL_PREAMBLE`; Known Facts block pattern
- `src/chris/modes/reflect.ts` — mode handler integration point for profile injection
- `src/rituals/weekly-review-sources.ts` — `loadWeeklyReviewContext` (pattern for parallel-fetch substrate loader)
- `src/db/schema.ts` — existing table shapes, epistemic tag enum (FACT/INTENTION/RELATIONSHIP/EXPERIENCE relevant to profile inference)
- `.planning/PROJECT.md` — D028 (attachment profile threshold precedent), D031 (Known Facts structured injection), D034/D035 (episodic boundary), D041 (primed-fixture convention)
- `M010_Operational_Profiles.md` — milestone spec (target features, acceptance criteria)
- `.planning/milestones/v2.4-MILESTONE-AUDIT.md` — M009 shipped substrate (wellbeing_snapshots, ritual_fire_events, episodic_summaries production consumer)

**Domain / concept validation (operational profile concept):**
- Operational profiles as a concept appear in personal knowledge management (PKM) and quantified-self literature under terms like "life OS", "personal CRM", and "situational context layer." No single canonical source — derived from first principles applied to the Chris PRD's "Pensieve with a voice" framing.
- Confidence calibration: EMA literature (same sources as M009 FEATURES.md §2 — Frontiers Psychology 2021 EMA review) establishes that below-threshold data produces worse inference than no inference. The 10-entry floor mirrors D028's 2,000-word threshold for attachment profile (same reasoning applied to a different scale).
- Case-file model for health: Derived from standard clinical documentation patterns (SOAP notes, problem list). The "open hypothesis / pending test / active treatment" triad is how clinicians maintain a differential diagnosis in progress — applied here to a personal health-tracking context.

---
*Feature research for: M010 Operational Profiles (soul-system milestone 5 of 9 — profile layer foundation)*
*Researched: 2026-05-11*
