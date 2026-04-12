# Project Chris — Implementation Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Docker Host (self-hosted server)               │
│                                                                     │
│  ┌──────────┐  ┌──────────────────────────┐  ┌───────────────────┐ │
│  │ Telegram  │  │       Chris App           │  │   PostgreSQL 16   │ │
│  │ Bot API   │──│      (Node.js 22)         │──│   + pgvector      │ │
│  │ (webhook  │  │                           │  │                   │ │
│  │  or poll) │  │  ┌─────────────────────┐  │  │ • pensieve_entries│ │
│  └──────────┘  │  │    Chris Engine      │  │  │ • pensieve_embeds │ │
│                │  │  6-mode auto-detect   │  │  │ • relational_mem  │ │
│                │  │  + contradiction det.  │  │  │ • conversations   │ │
│                │  │  + relational memory   │  │  │ • contradictions  │ │
│                │  │  + decision archive    │  │  │ • decisions       │ │
│                │  │  + profile layer       │  │  │ • episodic_sums   │ │
│                │  └─────────────────────┘  │  │ • profiles_*      │ │
│                │                           │  │ • life_chapters   │ │
│                │  ┌─────────────────────┐  │  │ • rituals         │ │
│                │  │  Proactive Sweep     │  │  │ • proactive_state │ │
│                │  │  Cron + Opus triggers │  │  │ • sync_status     │ │
│                │  │  + ritual scheduler   │  │  │ • oauth_tokens    │ │
│                │  └─────────────────────┘  │  └───────────────────┘ │
│                │                           │                       │
│                │  ┌─────────────────────┐  │  ┌───────────────────┐ │
│                │  │  Source Sync Cron    │  │  │     Volumes        │ │
│                │  │  Gmail/Immich/Drive  │  │  │  • pgdata          │ │
│                │  └─────────────────────┘  │  └───────────────────┘ │
│                └──────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Node.js 22 + TypeScript (ESM) | Fast iteration, strong Telegram/LLM ecosystem |
| **Database** | PostgreSQL 16 + pgvector | Relational + vector search in one DB; append-only pensieve; battle-tested |
| **LLM** | Anthropic Claude API — three-tier: Haiku 4.5 (classify), Sonnet 4.6 (converse), Opus 4.6 (deep analysis) | Matches cognitive weight to task weight |
| **Embeddings** | bge-m3 via @huggingface/transformers (local ONNX, 1024 dims, multilingual EN/FR/RU) | No API dependency, supports Greg's languages |
| **Telegram** | Grammy bot framework | Modern, TypeScript-native, middleware-based |
| **ORM** | Drizzle ORM + drizzle-kit | Type-safe, lightweight, auto-migration on startup |
| **Container** | Docker Compose | Single-host deployment on self-hosted server |

---

## Implementation Phases

### Phase 1 — Foundation (M001: Living Memory) ✅

- [x] Project scaffolding (TS, Docker, DB)
- [x] PostgreSQL + pgvector setup with auto-migrations
- [x] Drizzle schema (pensieve_entries, pensieve_embeddings, relational_memory, conversations, contradictions)
- [x] Telegram bot (Grammy) with auth middleware (single authorized user)
- [x] Pensieve store (append-only, verbatim, no trimming)
- [x] Epistemic auto-tagger (Haiku, 12-category enum, fire-and-forget)
- [x] bge-m3 local embeddings (1024 dims, ONNX, pre-cached in Docker image)
- [x] Semantic retrieval (cosine similarity via pgvector)
- [x] Chris engine — Journal mode (Sonnet, silent store + natural response)
- [x] Chris engine — Interrogate mode (Sonnet + retrieval-augmented, citation formatting)
- [x] LLM integration (Anthropic client, three-tier model strategy)
- [x] Conversation history persistence (last 20 messages)
- [x] Docker Compose deployment on self-hosted server
- [x] /health endpoint with DB probe + pgvector extension check
- [x] Multi-stage Dockerfile with pre-cached bge-m3 model

### Phase 2 — Depth (M002: Deep Counsel) ✅

- [x] 6-mode auto-detection (Journal, Interrogate, Reflect, Coach, Psychology, Produce)
- [x] Reflect mode — pattern synthesis grounded in Pensieve + relational memory (Sonnet)
- [x] Produce mode — collaborative brainstorming grounded in Pensieve (Sonnet)
- [x] Coach mode — direct pushback and challenge (Opus)
- [x] Psychology mode — depth psychology analysis with named frameworks (Opus)
- [x] Contradiction detection — semantic search for conflicts, confidence threshold ≥ 0.75, 3s timeout
- [x] Relational memory writer — fire-and-forget observations after journal exchanges
- [x] Hybrid retrieval (semantic + temporal weighting + epistemic tag filtering + mode-specific presets)
- [x] Context builder with relational memory integration for Reflect/Coach/Psychology prompts

### Phase 3 — External Sources (M003: Digital Life) ✅

- [x] Gmail thread ingestion via Google OAuth2 (full + incremental sync)
- [x] Immich photo metadata ingestion via API key auth
- [x] Google Drive document ingestion (reuses Gmail OAuth with scope extension)
- [x] Telegram file upload (PDF, text, markdown, CSV, JSON)
- [x] Background cron scheduler syncing all sources every 6 hours
- [x] /sync gmail, /sync photos, /sync drive, /sync status Telegram commands
- [x] Content-hash dedup and metadata-based upsert
- [x] Chunked embedding pipeline (1:N embeddings per entry)
- [x] Source provenance citations in retrieval responses

### Phase 4 — Proactive Chris (M004: Proactive Chris) ✅

- [x] Proactive sweep orchestrator with cron scheduling + timezone-aware daily cap
- [x] Silence trigger — detects unusual gaps in Greg's messaging rhythm
- [x] Commitment staleness trigger — detects forgotten INTENTION entries
- [x] Opus-powered pattern recurrence detection
- [x] Opus-powered unresolved thread detection
- [x] Two-phase trigger execution (SQL-first short-circuit saves Opus API cost)
- [x] Four-trigger priority ordering (silence → commitment → pattern → thread)
- [x] Natural language mute control ("quiet for a week" → proactive messages pause)
- [x] Engine pre-processing: mute detection before mode detection

### Phase 5 — Requirement Validation (M005) ✅

- [x] All 28 requirements resolved to terminal status (0 active remaining)
- [x] 15 requirements validated with specific test/code evidence
- [x] 11 requirements deferred with documented schema groundwork and missing implementation
- [x] 2 requirements out-of-scope

---

## Phase 6 onward — Soul System Build

The following phases implement the conceptual architecture for Chris as a longitudinal identity system: structured profiles, decision accountability, scheduled reflection rituals, and narrative identity. These build on the existing Pensieve, mode engine, and proactive infrastructure rather than replacing them.

**Sequencing rule:** Milestones are strictly sequential except where explicitly noted in the dependency table. Each milestone must include comprehensive test coverage using synthetic fixture data at the appropriate timescale before the next milestone is queued. A daily ritual is tested against 14 synthetic days; a weekly ritual against a synthetic week of episodic summaries; a monthly ritual against a synthetic month of profile state and behavior; a quarterly ritual against a synthetic quarter of summaries, decisions, and profile transitions. All tests run deterministically in minutes, not calendar time. Claude Code must generate the fixture data as part of each milestone's deliverables.

**Mocked vs live LLM testing:** Some test cases validate code logic (routing, state transitions, SQL, retrieval correctness) and can use mocked LLM responses. Other test cases validate prompt-level behavior (does the model actually refuse to return to a declined topic? does the constitutional preamble actually produce non-sycophantic responses?) and must run against the real Sonnet/Haiku/Opus models. These are marked as "live integration" tests in each milestone and run separately from the fast unit suite to control cost. M006 has the highest density of live integration tests because it is primarily a prompt-level milestone, but every milestone from M007 onward includes live integration tests wherever prompt behavior is being validated.

### Milestone dependency and sequencing table

| ID | Name | Depends on | Validation mechanism |
|----|------|------------|----------------------|
| M006 | Trustworthy Chris | M005 | Synthetic fixture data + live integration tests against real Sonnet |
| M007 | Decision Archive | M006 | Synthetic fixture data + live integration tests for detection/capture prompts |
| M008 | Episodic Consolidation | M007 | Synthetic fixture data: 14 days of Pensieve entries → 14 summaries |
| M009 | Operational Profiles | M008 | Synthetic fixture data: 30+ days of episodic summaries → profile population |
| M010 | Psychological Profiles | M009 | Synthetic fixture data: 30+ days of summaries + 5,000+ words of dialogue |
| M011 | Mental Model Inventory | M009 (can run in parallel with M010) | Synthetic fixture data: PRODUCE transcripts with named frameworks |
| M012 | Ritual Infrastructure + Daily Note | M010 and M011 | Synthetic fixture data: simulated 14-day cadence with skip tracking |
| M013 | Weekly/Monthly/Quarterly Rituals | M012 | Synthetic fixture data: one synthetic week, one month, one quarter |
| M014 | Narrative Identity | M013 | Synthetic fixture data: one synthetic quarter with chapter boundary signals |

M011 is the only milestone that can run in parallel with another (M010). All other milestones are strictly sequential.

---

### Phase 6 — Trustworthy Chris (M006: Conversation Foundation Fixes) ⚠️ URGENT

**Goal:** Chris stops ignoring refusals, stops performative apologies, stops language-mismatching, and is backed by a constitutional anti-sycophancy preamble applied across all modes. Also adds hybrid retrieval to JOURNAL mode so factual grounding is consistent with other modes.

**Diagnostic context:** Real-conversation testing (partly contradiction-detection stress testing where Greg deliberately fed conflicting statements, partly normal use) surfaced three failure modes traceable to specific code locations:

1. **Refusal handling.** The system prompts in `src/llm/prompts.ts` instruct Chris to "ask enriching follow-up questions" but contain no rule for handling refusals. When Greg said "I don't want to talk about that," Chris acknowledged and then re-asked a rephrased version of the same question in the next turn. This is the highest-priority fix — it's the most trust-breaking behavior observed.

2. **Language matching loses to statistical pull of history.** The prompt rule "respond in the same language as the user" is overridden when the prior 20 messages of conversation history are in a different language than the current message. Moving language detection from a prompt rule into engine pre-processing with a hard language parameter fixes this.

3. **Performative apologies without behavior change.** When called out on ignoring a refusal, Chris apologized and then repeated the same behavior. This is a downstream symptom of the refusal-handling gap — once R029 and R034 land, the apology pattern should disappear because there's nothing to apologize for.

**Additional hardening (not a diagnosed failure, but defense in depth):** JOURNAL mode in `src/chris/modes/journal.ts` does not currently retrieve from Pensieve at all — it passes only the last 20 conversation messages to Sonnet. Other modes (Reflect, Coach, Psychology) already use hybrid retrieval with `getRelationalMemories` and epistemic tag filtering. Bringing JOURNAL into line ensures factual grounding is consistent across all modes and reduces the risk of confabulation in long conversations where recent history is sparse on facts.

- [ ] Refusal handling rule added to all 7 system prompts in `src/llm/prompts.ts`
- [ ] Topic-decline state tracked per conversation: when user signals refusal, the topic is marked off-limits for the rest of the conversation, and Chris does not return to it
- [ ] JOURNAL mode in `src/chris/modes/journal.ts` upgraded with hybrid retrieval — pulls stable factual entries from Pensieve (FACT, RELATIONSHIP, PREFERENCE, VALUE tags) before each Sonnet call and injects them as grounded context, alongside the existing conversation history
- [ ] Language detection moved from prompt rule into engine pre-processing in `src/chris/engine.ts`: detect language of the *current* user message and pass as a hard system parameter to override conversation-history bias
- [ ] Question-pressure reduced in `JOURNAL_SYSTEM_PROMPT`: questions become optional rather than expected; Chris is allowed to simply respond without asking anything
- [ ] Constitutional anti-sycophancy preamble added as a shared prefix in `src/chris/personality.ts` `buildSystemPrompt()` and applied to all 7 modes — single source of truth for "agreement is something arrived at after examination, not the default state"
- [ ] Comprehensive conversational test suite covering: refusals (3 cases), factual accuracy under hybrid retrieval (3 cases), language switching mid-conversation (3 cases), topic-decline persistence within a session (3 cases), sycophancy resistance (3 cases) — 15 total test cases, all passing against real Sonnet (live integration)

### Phase 7 — Decision Archive (M007: Forecast Accountability)

**Goal:** Capture every structural decision Greg makes with its reasoning and a falsifiable forecast, then surface the forecast at its resolution date and prompt a post-mortem. This is the keystone feature for converting Chris from a reflective journal into an epistemic accountability tool.

**Why this is the highest-leverage feature:** Personality profiles are slow-moving and hard to validate. A decision archive is different: every captured decision with a forecast generates a future moment where reality answers. Over time this builds an empirical record of where Greg's reasoning is sharp and where it is systematically off. It is the only layer that can challenge rather than describe — a scoreboard rather than a mirror.

- [ ] New schema: `decisions` table with id, captured_at, decision, alternatives (JSONB array), reasoning, prediction, falsification_criterion, resolve_by, status (open/due/resolved/reviewed), resolution, resolution_notes, reviewed_at
- [ ] Decision detection added to engine: trigger phrases ("I'm thinking about", "I need to decide", "I'm weighing", "I'm not sure whether", and equivalents in French and Russian) activate the capture protocol
- [ ] 5-question capture protocol implemented as a guided sub-conversation: (1) the decision in one sentence, (2) the alternatives including rejected ones, (3) the reasoning, (4) a falsifiable prediction with timeframe, (5) what would tell Greg he was wrong
- [ ] Decision lifecycle state machine: open (just captured) → due (resolve_by passed, awaiting resolution prompt) → resolved (Greg has stated what happened) → reviewed (post-mortem complete)
- [ ] Forecast deadline scheduler integrated into the existing proactive sweep: when a decision's resolve_by passes, surface a resolution prompt within 24 hours
- [ ] Resolution flow: "On {date} you predicted {prediction}. What actually happened?" — captures Greg's response and stores it as both a Pensieve entry and the decisions.resolution_notes field
- [ ] `/decisions` Telegram command: lists open decisions, recently resolved, and forecast accuracy stats over rolling windows (30/90/365 days)
- [ ] Synthetic fixture data validation: test suite generates captured decisions with simulated `resolve_by` deadlines in the past, runs the proactive sweep, verifies resolution prompts surface correctly and lifecycle transitions happen in order

### Phase 8 — Episodic Consolidation (M008: Memory Tier 2)

**Goal:** Add a second memory tier above the Pensieve raw store: end-of-day episodic summaries that compress the day's entries into a structured narrative with importance scoring. Mirrors how human memory consolidates raw experience into general events overnight.

**Why this matters:** The Pensieve grows linearly forever and retrieval over years of raw entries becomes noisy. Episodic summaries serve as a higher-resolution index — "what happened this week" should not require reading every individual entry. This is the foundation for the structured profile layer and narrative identity layer in subsequent milestones.

- [ ] New schema: `episodic_summaries` table with id, summary_date, summary text, importance score (1–10), topics (text array), emotional_arc, key_quotes (text array), source_entry_ids (uuid array), created_at
- [ ] Daily consolidation job runs at the end of Greg's day in his timezone: pulls all Pensieve entries from that day, generates a structured summary via Sonnet, scores importance based on emotional intensity, novelty, decision presence, and contradiction presence
- [ ] Importance scoring rubric documented and enforced via prompt: 1–3 mundane, 4–6 notable, 7–9 significant, 10 life-event-level
- [ ] Retrieval logic in `src/pensieve/retrieve.ts` updated to route by recency: queries about the last 7 days read raw Pensieve entries; queries about older periods read episodic summaries first and only descend to raw entries when explicitly needed
- [ ] Synthetic fixture data validation: test suite generates 14 synthetic days of Pensieve entries spanning the importance range (mundane to life-event), runs the consolidation cron against each simulated day boundary, verifies correctness of summaries, calibration of importance scores, retrieval routing by recency, timezone boundary handling, and idempotency on retry

### Phase 9 — Operational Profiles (M009: Where Greg Is Right Now)

**Goal:** Add the first half of the structured profile layer — the "state of Greg's life right now" profiles that don't require psychological inference. Jurisdictional state, capital trajectory, health case file, and family formation arc. These are concrete, fact-based, and update on a weekly cadence from episodic summaries.

**Why split from M010:** These four profiles share a common pattern (factual extraction from recent data, weekly cadence, no psychological interpretation required) and deliver immediate value the moment they land. They also serve as the foundation for the harder psychological profiles in M010, which need this operational substrate to be meaningful. Splitting them prevents the profile work from becoming "build seven different things that share nothing but a directory name."

- [ ] New schemas: `profile_jurisdictional` (location, residency statuses JSONB, tax structures JSONB, next planned move, planned move date), `profile_capital` (FI phase, target amount, current estimated net worth nullable, next sequencing decision), `profile_health` (open hypotheses JSONB, pending tests JSONB, recent decisions JSONB, case file narrative), `profile_family` (milestones JSONB, constraints JSONB, evolving criteria)
- [ ] Each table includes `last_updated` timestamp and overall `confidence` (real, 0.0–1.0)
- [ ] Weekly update job: runs once per week, pulls the previous week's episodic summaries plus FACT/RELATIONSHIP-tagged Pensieve entries, updates the four profiles via Sonnet with prompts that explicitly require structured JSON output
- [ ] Confidence scoring based on data volume and consistency; minimum threshold of 10 distinct Pensieve entries before any profile is generated
- [ ] Profile retrieval interface in `src/memory/profiles.ts` exposing `getOperationalProfiles()` for use by Reflect, Coach, and Psychology modes
- [ ] `/profile` Telegram command (initial version): read-only summary showing the four operational profiles with confidence ranges; psychological profiles section shows "not yet available" until M010
- [ ] Synthetic fixture data validation: test suite generates 30+ days of synthetic episodic summaries covering all four profile dimensions, runs the weekly update job, verifies all four profiles populate correctly with calibrated confidence scores, and confirms the minimum-data threshold correctly suppresses output when data is insufficient

### Phase 10 — Psychological Profiles (M010: HEXACO and Schwartz Values)

**Goal:** Add the slower, interpretive half of the profile layer — HEXACO personality traits and Schwartz universal values. These require accumulated data, monthly cadence, explicit minimum thresholds, and careful confidence calibration. Higher risk of bad outputs than M009, so they get their own milestone where the focus is on calibration over coverage.

**Why this is later than M009:** Psychological inference from speech is empirically valid but modest in accuracy (r ≈ .31–.41 in published research). Building these profiles correctly requires (a) enough data to be meaningful, (b) explicit confidence intervals, and (c) the operational substrate from M009 to ground the inferences in real-life context. Rushing this milestone produces shallow personality stereotypes, which is worse than not having the feature at all.

- [ ] New schemas: `profile_hexaco` (Honesty-Humility, Emotionality, Extraversion, Agreeableness, Conscientiousness, Openness — each with score and per-dimension confidence), `profile_schwartz` (10 universal values: Self-Direction, Stimulation, Hedonism, Achievement, Power, Security, Conformity, Tradition, Benevolence, Universalism — each with score and per-dimension confidence)
- [ ] Monthly update job: runs once per month, pulls the previous month's episodic summaries and Pensieve entries, updates HEXACO and Schwartz profiles via Sonnet with structured JSON output prompts
- [ ] Minimum data threshold strictly enforced: 5,000 aggregated words from Greg (not from Chris) before any HEXACO or Schwartz profile is generated. Below threshold, profiles return "insufficient data — need X more words" rather than low-confidence guesses.
- [ ] Per-dimension confidence ranges always shown alongside scores; confidence reflects both data volume and inter-period consistency
- [ ] Integration into Reflect/Coach/Psychology mode prompts: psychological profiles formatted into system prompts as grounded context with explicit confidence framing
- [ ] `/profile` Telegram command extended to show the psychological profiles section once data threshold is met
- [ ] Synthetic fixture data validation: test suite generates 30+ days of synthetic episodic summaries plus 6,000+ words of simulated dialogue reflecting a specific personality signature (e.g., high Openness, low Conformity). Runs the monthly update job. Verifies that (a) a 1,000-word fixture produces no profile, (b) a 6,000-word fixture produces a populated profile with confidence > 0, (c) the detected signature roughly matches the fixture's designed signature within expected accuracy bounds

### Phase 11 — Mental Model Inventory (M011: Frameworks Greg Uses)

**Goal:** Track the analytical frameworks, mental models, and decision heuristics Greg uses in conversation. Different from operational profiles (facts about Greg's life) and psychological profiles (traits and values) — this profile is about *how Greg thinks*, captured continuously as he reasons out loud.

**Why a separate milestone:** Mental model detection is a different problem from profile inference. It looks for analytical patterns in conversation (named frameworks, decision criteria, recurring heuristics) rather than life facts or value statements. It updates continuously rather than weekly or monthly. The detection logic and storage model are different enough that bundling it with M009 or M010 would force the wrong architecture. **Can run in parallel with M010** because the schemas, detection paths, and update cadences are completely independent.

- [ ] New schema: `profile_mental_models` table with id, name, description, first_observed_at, last_applied_at, application_count, source_entry_ids (uuid array), confidence
- [ ] Continuous detection: a background analyzer (triggered after every PRODUCE-mode exchange and on a daily sweep over recent JOURNAL entries) uses Haiku to detect named frameworks or recurring analytical patterns and either creates new mental model entries or updates application counts on existing ones
- [ ] Deduplication: similar mental models are merged based on semantic similarity; a high bar prevents trivial detections from polluting the inventory
- [ ] `/models` Telegram command: lists mental models in active use, sorted by recency or application count, with the source entries that grounded each detection
- [ ] Integration into Reflect mode: pattern synthesis can reference which mental models Greg has been using during a given period
- [ ] Synthetic fixture data validation: test suite generates PRODUCE-mode transcripts containing explicit named frameworks (e.g., "let me think about this with the demand-first SaaS validation framework") and implicit recurring analytical patterns, runs the detection pipeline, verifies correct creation, deduplication via embedding similarity, and application count tracking

### Phase 12 — Ritual Infrastructure + Daily Note (M012: Foundation for Cadence-Driven Reflection)

**Goal:** Build the scheduling and tracking infrastructure for rituals, plus the simplest ritual (the daily voice note). Proves the infrastructure works end-to-end with the lowest-complexity ritual before the heavier protocols are built on top in M013.

**Why split from M013:** The daily note is genuinely different from the weekly/monthly/quarterly protocols — it's one-way deposit with no Chris response, no conversation flow, no guided protocol. It belongs with the infrastructure because together they form a minimum viable end-to-end ritual system. The heavier rituals all share patterns with each other (one observation, structured protocol, guided sub-conversation) and benefit from being built together in M013.

- [ ] New schema: `rituals` table with id, type (enum: daily, weekly, monthly, quarterly), last_run_at, next_run_at, enabled, config JSONB, skip_count, created_at
- [ ] Scheduler integration with the existing proactive sweep in `src/proactive/sweep.ts`: rituals are scheduled events with fixed cadences; existing reactive triggers (silence, commitment, pattern, thread) remain unchanged; both coexist
- [ ] Skip tracking: each ritual tracks completion and consecutive skips
- [ ] Ritual adjustment dialogue: if a ritual is skipped 3 or more times in a row, Chris surfaces it for adjustment instead of firing the standard prompt — "this ritual isn't working, what should change?" — and uses Haiku to parse natural language updates to the `rituals.config` field
- [ ] Daily voice note ritual: rotating pool of 6 prompts ("What mattered today?", "What's still on your mind?", "What did today change?", "What surprised you today?", "What did you decide today, even if it was small?", "What did you avoid today?"), fired at end of Greg's day, no Chris response — deposit only, with rotation logic preventing two consecutive duplicate prompts
- [ ] Synthetic fixture data validation: test suite simulates 14 consecutive days by advancing a mock clock, verifies daily prompts fire on schedule with correct rotation (no two consecutive duplicates), responses store correctly as Pensieve entries, skip tracking increments on missed days, and the adjustment dialogue triggers after 3 consecutive skips

### Phase 13 — Weekly, Monthly, Quarterly Rituals (M013: Guided Reflection Protocols)

**Goal:** Build the three heavier ritual protocols on top of the proven infrastructure from M012. Weekly review, monthly reconciliation, quarterly chapter review — each a guided multi-step protocol with its own LLM prompts and conversation flow.

**Why these belong together:** All three rituals share common patterns — Chris initiates, presents observations or summaries from accumulated data, asks structured questions, captures Greg's responses, stores outputs back into the system. Building them as a single milestone produces less duplication than building them separately, and the test infrastructure is shared.

- [ ] Weekly review ritual (Sunday evening default, configurable): Chris generates one observation from the week's data (episodic summaries and decisions resolved), asks one Socratic question tied to the observation, leaves one open slot for Greg. Maximum one question per turn — enforced at runtime.
- [ ] Monthly reconciliation ritual (first weekend of the month): structured 4-step protocol — (1) summary readout of the month, (2) reconciliation of stated values from `profile_schwartz` against revealed behavior from episodic summaries, (3) Greg responds to the reconciliation, (4) Greg states one thing to change, one to protect, one open question for next month
- [ ] Quarterly chapter review ritual (last weekend of each quarter): Butler 4-step life-review protocol — (1) what happened (narrative summary), (2) what learned (patterns), (3) how interpreted now (meaning-making), (4) next chapter title and theme. Output of step 4 is stored as a tagged Pensieve entry until M014 lands, at which point it migrates to a `life_chapters` row.
- [ ] Synthetic fixture data validation: test suite generates (a) one synthetic week of episodic summaries and resolved decisions, runs the weekly review, verifies exactly one observation and one Socratic question are produced; (b) one synthetic month with values-behavior mismatches, runs the monthly reconciliation, verifies at least one specific value-vs-behavior comparison is surfaced; (c) one synthetic quarter of three months with profile transitions and decisions, runs the quarterly chapter review, verifies all 4 Butler steps complete and output persists correctly

### Phase 14 — Narrative Identity (M014: Memory Tier 4)

**Goal:** Add the fourth and final memory tier: life chapters with narrative themes. The integrative layer that turns episodic summaries and profile data into a coherent (but not over-coherent) life story, updated quarterly through the chapter review ritual.

**Theoretical grounding:** Dan McAdams' narrative identity framework, which has incremental validity over personality traits for predicting well-being. Key constructs: redemption sequences (bad-to-good), contamination sequences (good-to-bad), agency themes (mastery, control), communion themes (love, belonging). Chapter boundaries are heuristic — major life transitions detected from profile and event data — with manual override always available.

- [ ] New schema: `life_chapters` table with id, start_date, end_date (nullable for current chapter), title, narrative_summary, themes JSONB (redemption_count, contamination_count, agency_score, communion_score, top_themes array), created_at, updated_at
- [ ] McAdams theme extraction: Opus-powered analysis of episodic summaries and significant Pensieve entries within a chapter window, scoring redemption/contamination sequences and agency/communion themes
- [ ] Chapter boundary detection: heuristic based on jurisdictional changes, capital phase transitions, family arc milestones, and major decisions resolved. Always proposes boundaries to Greg for confirmation rather than auto-committing.
- [ ] Quarterly chapter review ritual from M013 enhanced to use M014 capabilities: "what happened" step uses chapter narrative summary; "what did you learn" step uses theme extraction; "next chapter" step creates an actual `life_chapters` row
- [ ] Chapter naming as collaborative output: Chris proposes 2–3 candidate names based on themes; Greg picks or overrides
- [ ] Reflect mode enhanced with chapter-aware retrieval: pattern synthesis can scope to "this chapter", "previous chapter", or "across chapters"
- [ ] Migration of pre-M014 quarterly review outputs (stored as tagged Pensieve entries during M013) into proper `life_chapters` rows
- [ ] Synthetic fixture data validation: test suite generates one synthetic quarter of episodic summaries and profile state with a clear life transition embedded (e.g., simulated relocation mid-quarter), runs theme extraction and boundary detection, verifies chapter boundary is proposed at the transition point, themes populate correctly, and the collaborative naming flow produces multiple candidate names

---

## Key Patterns

- **Fire-and-forget** for tagging, embedding, relational memory (never block response)
- **Engine orchestrator** — detect mode → route to handler → post-processing (contradiction, relational) → save
- **Three-tier LLM** — Haiku classify, Sonnet converse, Opus deep analysis
- **Two-phase trigger execution** — cheap SQL gates expensive Opus calls
- **Source pipeline** — client → metadata converter → sync orchestrator → command handler
- **Never-throw contract** — side-effects (tagging, embedding, contradiction, relational) log errors and swallow
- **Tiered memory consolidation** (M008+) — raw Pensieve → episodic summaries → structured profiles → life chapters; each tier consolidates upward on its own cadence
- **Decision accountability** (M007+) — every captured decision generates a future resolution moment; reality is the validator, not Chris
- **Constitutional anti-sycophancy** (M006+) — single shared preamble across all modes; agreement is an output of examination, not the default
- **Synthetic fixture data validation** (M006+) — every milestone includes a test suite that generates synthetic data and runs the pipeline deterministically; cadence-driven features are tested at the appropriate timescale (14 synthetic days, one synthetic week/month/quarter); prompt-level behavior is validated with live integration tests against real Sonnet/Haiku/Opus; no calendar waiting between milestones

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| **Data loss** | PostgreSQL WAL + append-only design; persistent Docker volume |
| **API costs** | Haiku for cheap ops; Opus gated behind SQL triggers; local embeddings |
| **Latency** | Async tagging/embedding; 3s contradiction timeout; conversation history capped at 20 |
| **Hallucination** | System prompts forbid ungrounded facts; retrieval citations required; explicit uncertainty flags; M006 brings JOURNAL mode into line with other modes' hybrid retrieval |
| **False positive contradictions** | Confidence threshold ≥ 0.75; high bar in detection prompt |
| **Sycophancy** | M006 constitutional preamble; M007 forecast accountability provides empirical correction; agreement-to-challenge ratio tracked |
| **Profile over-confidence** | M009/M010 minimum data thresholds; confidence ranges always shown; no inference from sparse data; psychological profiles separated from operational profiles to allow stricter calibration |
| **Ritual fatigue** | M012 skip tracking; consistently-skipped rituals adjusted, not enforced |
| **Over-coherent narrative** | M014 chapter boundaries always proposed for confirmation; contradictions preserved across chapters; no auto-resolution |
| **Scope creep within milestones** | Milestones split aggressively at design time; M009/M010/M011 separated by data type and update cadence rather than bundled into one "profiles" milestone; M012/M013 split by complexity rather than bundled into one "rituals" milestone |
| **Prompt-level regressions invisible to unit tests** | M006 adds a 15-case live-integration test suite against real Sonnet to catch behavioral failures that mocked tests miss |

---

## Current State

M001–M005 complete. Chris is deployed and running on self-hosted server. 285 tests passing across 16 test files. Both containers healthy.

M006 is the next milestone and is marked URGENT — it fixes conversational trust failures observed in real Telegram use (refusal handling, language matching, question-pressure) that would compound across all subsequent milestones if left unaddressed. M006 is validated the same way as every other milestone: synthetic fixture data plus live integration tests against the real Sonnet model. No calendar wait between milestones. Claude Code generates the fixture data as part of each milestone's deliverables.
