# Project Chris — Implementation Plan

This is the single source of truth for Project Chris. It contains the project context, architectural constraints, key decisions, and the full milestone roadmap. `.planning/PROJECT.md` is a symlink to this file so GSD v1 skills can find it at the expected path while reading the same content.

## What This Is

Chris is a personal AI entity for a single user (Greg), running as a self-hosted Telegram bot. He is a **Pensieve**: an append-only, verbatim store of Greg's memories, thoughts, emotions, ideas, and decisions, paired with semantic retrieval that makes the accumulated memory actively useful. Chris stores silently, responds naturally, and speaks as a first-person entity whose personality emerges from the data rather than from hardcoded prompts. He never flatters, never hallucinates, and always sources claims from the Pensieve.

## Core Value

Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve entries for recent-fidelity answers, episodic daily summaries for older context, with retrieval routing by recency and query intent.

Chris is a tool for authoring a more examined life, not a vessel for preserving a soul. This framing — from the design PRD — makes the methodology tractable instead of metaphysical and shapes every subsequent architectural choice.

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

## Constraints

- **Runtime**: Node.js 22 + TypeScript (ESM) — chosen for fast iteration and strong Telegram/LLM ecosystem.
- **Database**: PostgreSQL 16 + pgvector — relational and vector search in one DB; append-only Pensieve; battle-tested.
- **LLM**: Anthropic Claude API three-tier — Haiku 4.5 (classify/tag/mode-detect), Sonnet 4.6 (converse), Opus 4.6 (deep analysis). Matches cognitive weight to task weight.
- **Embeddings**: bge-m3 via `@huggingface/transformers` — local ONNX, 1024 dimensions, multilingual (EN/FR/RU natively). No embedding API dependency.
- **Telegram framework**: Grammy — modern, TypeScript-native, middleware-based.
- **ORM**: Drizzle ORM + drizzle-kit — type-safe, lightweight, auto-migration on startup.
- **Deployment**: Docker Compose on self-hosted Proxmox (192.168.1.50). Single-host. Persistent volumes for pgdata.
- **Single authorized user**: Only Greg's Telegram user ID is accepted. Everything else is silently dropped at the Grammy auth middleware.
- **Never fabricate**: Chris must never state as fact anything Greg has not told him. Uncertainty is explicit when data is thin.
- **Never block**: Tagging, embedding, contradiction detection, and relational memory writes are fire-and-forget — never block the primary response.
- **Production discipline**: build and test locally against Docker Postgres, push to Proxmox only after all tests green, never push without explicit user confirmation.

---

## Requirements

Requirements are tracked **per milestone**, not aggregated here:

- v2.0 M006: `.planning/milestones/v2.0-REQUIREMENTS.md` (26/26 satisfied)
- v2.1 M007: `.planning/milestones/v2.1-REQUIREMENTS.md` (31/31 satisfied)
- v2.2 M008: `.planning/milestones/v2.2-REQUIREMENTS.md` (35/35 satisfied)
- v2.3 Test Data Infrastructure: `.planning/milestones/v2.3-REQUIREMENTS.md` (20/20 satisfied)
- **v2.4+ M009 and beyond:** spec files in repo root (`M009_*.md` … `M014_*.md`); next milestone kickoff via `/gsd-new-milestone "M009 Ritual Infrastructure + Daily Note + Weekly Review"`.

See `## Current State` for the active milestone status and `## Implementation Phases` for the phase-level breakdown.

---

## Key Decisions

| ID | Decision | Rationale |
|---|---|---|
| **D001** | Three-tier LLM strategy (Haiku / Sonnet / Opus) | Match cognitive weight to task weight. Haiku tags and classifies, Sonnet converses, Opus does deep psychology / pattern work. |
| **D002** | bge-m3 local embeddings, not API-based | No external dependency, 1024 dims is enough, native multilingual for EN/FR/RU. |
| **D003** | PostgreSQL + pgvector, not a separate vector DB | One DB is simpler than two. pgvector is production-grade. |
| **D004** | Append-only Pensieve, no lossy operations | Data integrity is non-negotiable. Soft-delete only via explicit Greg command. |
| **D005** | Fire-and-forget for tagging, embedding, relational memory | Never block the user-visible response. Side effects log errors and swallow. |
| **D006** | 3-second timeout on contradiction detection, confidence ≥ 0.75 | False positives are worse than misses — a bad contradiction notice breaks trust more than a missed one. TRUST-12 adds a synthetic false-positive audit. |
| **D007** | Hybrid retrieval across modes (Reflect, Coach, Psychology, Produce) | Grounding in both semantic similarity and temporal / epistemic tag filters produces better recall than pure cosine. |
| **D008** | Chris speaks in first person as a distinct entity | He is a Pensieve with a voice, not a chatbot. Personality emerges from the data, not from character prompts. |
| **D009** | Single authorized Telegram user | Multi-tenancy is out of scope. Auth middleware is the first in the Grammy chain. |
| **D010** | Proactive sweep uses two-phase trigger execution | Cheap SQL gates expensive Opus calls. Silence and commitment triggers run first; pattern and thread triggers only fire if the cheap gates pass. |
| **D011** | Source provenance on every entry | Every Pensieve entry tracks source (telegram, gmail, immich, drive, document_import). Citations carry the source through to retrieval responses. |
| **D015** | Proactive state in key-value `proactive_state` table | Simple schema, flexible JSONB value, works for last_sent, mute_until, sweep metadata. |
| **D016** | Build and test locally, then deploy | Never debug on the live Proxmox server. `docker-compose up` for Postgres locally, all tests green locally, THEN push. |
| **D017** | Never lose work — every milestone commits before deploy | All code on main (or milestone branch). Merges must bring actual source files, not just planning artifacts. |
| **D018** | No skipped tests | All unit and integration tests run locally against Docker Postgres with dummy data. The sync integration test uses a local test database, not skipped. Only exception: live Telegram API connection tests (bot token validation). |
| **D019** | Production deployment requires explicit user approval | Never push to or restart the Proxmox production server without an explicit "yes" from Greg. Build the plan, present it, wait for confirmation. |
| **D020** | M006 refusal detection is pattern-based, not Haiku-classified | 15–20 regex patterns per language (EN/FR/RU) are cheap, deterministic, and good enough. Latency cost of Haiku classification on every message isn't worth the marginal accuracy gain for a well-bounded problem. |
| **D021** | M006 language detection uses `franc` with a minimum-length threshold | Messages below 4 words or 15 characters inherit the language of the previous user message in the conversation. Default to English only if no prior user message exists. |
| **D022** | M006 constitutional preamble is a floor, not a ceiling | `buildSystemPrompt(mode)` prefixes a shared anti-sycophancy preamble to each existing mode prompt. COACH's existing directness guidance stays exactly as it is — the preamble is additive, not a replacement. |
| **D023** | M006 live integration tests assert absence of bad behavior, not presence of exact text | Each test case runs 3 times against real Sonnet and requires 3-of-3 passes to handle non-determinism. Retrieval grounding tests use a Haiku follow-up call to verify consistency with seeded Pensieve facts. Sycophancy tests use keyword markers to distinguish engagement language from pure validation. |
| **D024** | Anti-sycophancy has four layers, not one | (1) Constitutional preamble (TRUST-05), (2) structural defenses woven into rituals and decision archive (RRIT-05 devil's advocate, RRIT-08 steelman-then-challenge, forecast accountability in M007), (3) behavioral monitoring surfacing vital signs to Greg (RRIT-07 agreement-to-challenge ratio + comfort-zone detection), (4) three absolute forbidden behaviors as hard constitutional constraints (TRUST-10). Single-layer defenses erode over long conversations; four layers make the system robust. |
| **D025** | Praise quarantine runs as engine post-processing, not as a prompt rule | Prompt rules against flattery drift over long sessions and across mode handlers. Post-processing audit (TRUST-09) is deterministic and catches reflexive praise regardless of which mode generated it. COACH and PSYCHOLOGY modes already forbid flattery at the prompt level and bypass the post-processor. |
| **D026** | Daily wellbeing snapshot is separate from the daily journal | The daily journal is deposit-only narrative (RIT-04). The wellbeing snapshot (RIT-06) is three numeric taps (energy/mood/anxiety, 1–5 each). Combining them would either bloat the journal ritual with structured questions or pollute the numeric series with interpretation. Keeping them separate preserves the frictionlessness of each. |
| **D027** | The Hard Rule: Chris never tells Greg he is right because of who he is | The trap of personal AI is that the better the system knows the user, the more it can construct flattery that feels like insight. Appeals to Greg's past track record as evidence for current claims are forbidden entirely (TRUST-08). Every claim is evaluated on its own merits. |
| **D028** | Attachment dimensions profile is deferred with an automatic activation trigger | Below 2,000 words of relational speech over 60+ days, the profile returns "insufficient data" (ATTACH-01). Inferring attachment from sparse data produces stereotypes worse than no profile. Weekly sweep monitors threshold; when crossed, profile activates without manual intervention. |
| **D029** | Execution order prioritizes MVP (M006→M007→M008→M009) ahead of the profile layer | Per the PRD's "start with decision archive + daily journal" principle, M009 (ritual infrastructure + daily journal + weekly review) executes immediately after M008 episodic consolidation, before any profile milestone. The daily journal and weekly review only need M008 summaries and M007 decisions; neither requires profile inference. Shipping M009 early delivers real user value and starts the daily data accumulation that M010–M012 profile inference actually requires. |
| **D030** | Weekly review ships in M009, not M013 | Weekly review (RRIT-01) only depends on M008 episodic summaries and M007 resolved decisions — no profile layer required. Shipping it as part of M009 completes the reflection cadence as part of the MVP (daily + weekly) instead of gating the weekly loop behind months of profile buildup. Monthly and quarterly rituals remain in M013 because monthly reconciliation requires Schwartz values (M011) and quarterly Butler review benefits from all profiles (M010/M011/M012). |
| **D031** | Memory retrieval injects structured facts, not prose dump | Real Telegram testing showed Chris confabulating facts (Cagnes-sur-Mer vs Golfe-Juan, wrong move direction) because memory was dumped as prose text into the context window. TRUST-11 refactors retrieval to emit a "Known Facts About Greg" block in key-value form, separate from the narrative context block. Structured facts are much harder for the LLM to misremix. |
| **D032** | Hallucination resistance and performative apology detection are live integration tests, not unit tests | Both failure modes are prompt-level behaviors that only manifest against real Sonnet. TRUST-07 extends from 15 test cases to 24 (adding hallucination resistance, structured fact retrieval accuracy, performative apology detection). Mocked LLM tests cannot catch these failures because they depend on how the real model interprets the system prompt under adversarial conditions. |
| **D033** | Contradiction detection gets an explicit false-positive audit | The existing M002 confidence threshold (≥0.75) minimizes false positives but doesn't test them. TRUST-12 adds a synthetic fixture of 20 adversarial non-contradictory pairs and requires 0 false positives. False positive contradiction notices are trust-breaking and must be actively tested, not assumed. |
| **D034** | `episodic_summaries` ships as 8 columns with all three indexes in migration 0005 — not retrofitted | Locked in Phase 20 CONTEXT: `id` (uuid pk), `summary_date` (date NOT NULL UNIQUE), `summary` (text NOT NULL), `importance` (integer 1-10 CHECK), `topics` (text[] default '{}'), `emotional_arc` (text NOT NULL), `key_quotes` (text[] default '{}'), `source_entry_ids` (uuid[] default '{}'), `created_at` (timestamptz default now()). `UNIQUE(summary_date)` (idempotency + DST safety), `GIN(topics)` (M009 weekly aggregation), `btree(importance)` (M010 profile inference + M008 high-importance raw descent). Retrofitting indexes later would require migration plumbing; shipping them in 0005 is strictly cheaper. |
| **D035** | Pensieve remains authoritative — episodic tier is a projection, not a replacement | RETR-05/06 boundary preservation: summary text NEVER enters the Known Facts block (`src/chris/personality.ts`) and NEVER embeds into `pensieve_embeddings`. Enforced structurally by `src/chris/__tests__/boundary-audit.test.ts` — fails if `\bepisodic_summaries\b\|\bepisodicSummaries\b` ever appears in personality.ts / ground-truth.ts / embeddings.ts. Summaries are interpretation (D031); raw entries are facts. Mixing them pollutes both. |
| **D036** | `retrieveContext` is two-dimensional routing (recency + query intent), not one-dimensional age-based | `RECENCY_BOUNDARY_DAYS = 7` inclusive; `HIGH_IMPORTANCE_THRESHOLD = 8` inclusive. Five named `RoutingReason` literals (`verbatim-keyword`, `recent`, `no-summary-fallback`, `high-importance-descent`, `summary-only`) for diagnostic visibility. A query containing "exactly"/"verbatim"/"what did I say" etc. overrides recency and returns raw entries regardless of age (verbatim fidelity is a harder guarantee than freshness). |
| **D037** | INTERROGATE has its own ad-hoc date routing, separate from general retrieveContext — intentional | `interrogate.ts:61-91` documents the rationale: different UX contract (citation-anchored Q&A) and different header form (`## Recent Episode Context (interpretation, not fact)` D031 boundary marker before Known Facts). INTERROGATE's `extractQueryDate` + `getEpisodicSummary` path is purpose-built for date-anchored questions; the general `retrieveContext` orchestrator is purpose-built for mode handlers that do not anchor on dates. |
| **D038** | Live anti-flattery test (TEST-22) is the empirical proof M006 preamble works end-to-end in cron-invoked consolidation | The M006 constitutional preamble is the engine's only anti-sycophancy guarantee. In consolidation the preamble must be explicitly injected (the cron runs outside the engine context). TEST-22 asserts 3-of-3 atomic against real Sonnet on an adversarial fixture designed to bait flattery. 17 forbidden flattery markers surveyed from existing M006 conventions (NOT invented). Shipped passing with zero markers across 3 iterations. |
| **D039** | No Haiku fallback in verbatim-keyword fast-path (M008 deferral) | 15-keyword EN/FR/RU `VERBATIM_KEYWORDS` list is the sole gate; afterAll cumulative assertion `expect(mockAnthropicCreate).not.toHaveBeenCalled()` enforces. M009+ may add a Haiku fallback when real-world miss rate is measurable. Adding a classifier call to every chat message has a latency cost that is only worth paying once we know the keyword list misses in practice. |
| **D040** | Decimal phases (e.g., 22.1) are the mid-milestone gap-closure pattern | Pattern borrowed from v2.1 Phase 15.1/16.1 precedent. When a milestone audit reveals a wiring gap that is not a re-open of the originating phase's scope, insert a decimal phase with explicit `(INSERTED)` marker in the progress table and plan numbering `22.1-01` (not 22-06). Keeps the audit trail clean: each phase's plans stay bounded; decimal phases are always gap-closure. Used in v2.2 for Phase 22.1 to wire `retrieveContext` into 5 chat-mode handlers after Phase 22's implementation shipped orphaned. |
| **D041** | Test data via primed-fixture pipeline (v2.3) — no calendar-time data-accumulation gates | No milestone may gate on real wall-clock time for data accumulation (e.g. "wait 7 days to accumulate real episodic summaries before M009 can be tested"). The primed-fixture pipeline (Phase 24) produces fused organic+synthetic test fixtures on demand — organic base from live prod via SSH-tunneled postgres.js dump, synthetic delta via per-day Haiku style-transfer + real `runConsolidate()` episodic synthesis, all VCR-cached. Tests consume via `loadPrimedFixture('m008-14days')`. See `.planning/codebase/TESTING.md §Primed-Fixture Pipeline` and `.planning/codebase/CONVENTIONS.md §Test Data`. Replaces the v2.2 pain point where M008 testing implicitly gated M009 planning on 7 real calendar days of Greg's active use. |

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

Milestones M006–M014 implement the "soul system" described in `PRD_Project_Chris.md`. Each milestone has its own file in the repo root (`M006_*.md` through `M014_*.md`) containing the full goal, target features, acceptance criteria, and pause-before-next-milestone constraint. Those files are the authoritative specs and are designed to be fed into `/gsd:new-milestone "<name>"` one at a time.

**Execution order (strictly sequential except M012 which can run in parallel with M011):**

| # | Version | ID | Name | Depends on |
|---|---------|----|------|------------|
| 1 | v2.0 | M006 | Trustworthy Chris ⚠️ URGENT | M005 |
| 2 | v2.1 | M007 | Decision Archive | M006 |
| 3 | v2.2 | M008 | Episodic Consolidation | M007 |
| 3.5 | **v2.3** | **—** | **Test Data Infrastructure** *(pre-M009 enabler, single-phase; primed-fixture pipeline, organic from prod + synthetic delta)* | M008 |
| 4 | v2.4 | **M009** | **Ritual Infrastructure + Daily Note + Weekly Review** *(MVP shipping point)* | v2.3 Test Data Infra + M008 |
| 5 | v2.5 | M010 | Operational Profiles | M009 |
| 6 | v2.6 | M011 | Psychological Profiles | M010 |
| 7 | v2.7 | M012 | Mental Model Inventory | M010 (parallel with M011) |
| 8 | v2.8 | M013 | Monthly + Quarterly Rituals + Anti-Sycophancy Monitoring | M011 and M012 |
| 9 | v2.9 | M014 | Narrative Identity | M013 |

**M009 is the MVP shipping point.** After M006→M007→M008→M009, Greg has refusal-respecting Chris with constitutional anti-sycophancy, decision capture with forecasts, episodic summaries, daily journal, daily wellbeing snapshot, and weekly review. Profile layer (M010–M012) consumes the real data M009 produces — running it earlier produces empty profiles with no inference to make.

**Sequencing rule:** Each milestone must include synthetic fixture tests at the appropriate timescale (14 days for daily rituals, one week for weekly, one month for monthly, one quarter for quarterly). Tests run deterministically in minutes, not calendar time. Prompt-level behavior is validated with live integration tests against real Sonnet — M006 has the highest density because it is primarily a prompt milestone.

**Pause between milestones is mandatory.** Do not sprint from M006 to M007 to M008. Each milestone file specifies its own pause duration. M009 requires at least one month of real use before M010 starts.

## Out of Scope and Deferred

**Out of scope** (explicitly excluded — documented to prevent scope creep):

- **Direct Telegram photo handling** — covered by Immich ingestion path; no native Telegram photo flow.
- **Multi-tenancy / multi-user support** — Chris serves one user only by design.
- **Autonomous actions beyond proactive outreach** — Chris is an advisor and repository, not an agent. He never executes anything on Greg's behalf without explicit instruction.

**Deferred** (excluded for now, with explicit re-evaluation criteria):

- **Voice message transcription via Whisper** — risk of transcription errors polluting the Pensieve is too high. Android keyboard STT (dictation) is the pragmatic alternative: free, accurate, user reviews/edits before sending. Revisit only if a review/confirm-before-storage flow is built first.
- **ATTACH-01 — Attachment dimensions profile** — a deferred psychological profile tracking adult attachment style (anxious, avoidant, secure dimensions) from relational speech data. Activates automatically when the Pensieve contains at least 2,000 words of Greg's speech describing interactions with people he is emotionally involved with (partner candidates, family members, close friends), over at least 60 days. Below threshold, returns "insufficient relational data — defer". Inferring attachment from sparse data produces stereotypes worse than no profile; weekly sweep monitors the threshold and activates without manual intervention when crossed.
- **VIA Character Strengths profile** — explicitly skipped per the PRD audit. Generic and low-signal for Greg specifically. Strengths are visible in his behavior already, and the framework's resolution is too coarse for someone who self-models with precision.

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
| **Profile over-confidence** | M010/M011 minimum data thresholds; confidence ranges always shown; no inference from sparse data; psychological profiles separated from operational profiles to allow stricter calibration |
| **Ritual fatigue** | M009 skip tracking; consistently-skipped rituals adjusted, not enforced |
| **Over-coherent narrative** | M014 chapter boundaries always proposed for confirmation; contradictions preserved across chapters; no auto-resolution |
| **Scope creep within milestones** | Milestones split aggressively at design time; M010/M011/M012 separated by data type and update cadence rather than bundled into one "profiles" milestone; M009/M013 split by complexity rather than bundled into one "rituals" milestone |
| **Prompt-level regressions invisible to unit tests** | M006 adds a 15-case live-integration test suite against real Sonnet to catch behavioral failures that mocked tests miss |

---

## Claude Code Execution Guidelines

These instructions shape HOW each milestone gets handed to Claude Code. They are derived from the design PRD and are mandatory for every milestone from M006 onward.

### One phase per session, not one prompt

Each milestone (or major phase within a milestone) is its own Claude Code session with a clear deliverable. Do not chain phases in a single conversation — context degrades and each phase must be testable before moving on.

### Start with context, not tasks

The first message of each phase must give Claude Code: what Chris currently is, what has been built in previous phases, what this phase is supposed to deliver, and what success looks like. The actual implementation instructions come after. This is the difference between Claude Code building the right thing and Claude Code building a thing that happens to compile.

### Define "done" before you start

Each phase needs a concrete acceptance criterion. Not "Chris responds better" — something testable like "when I send a message refusing a topic, Chris does not return to that topic in the same conversation, verified across 5 test exchanges against real Sonnet."

### The "summarize and wait" gate

Before writing any code, Claude Code must summarize what it understands the goal to be and what its implementation approach will be. Wait for approval before starting. This catches misunderstandings before they become 500 lines of wrong code. This gate is non-negotiable for any milestone that touches prompts, system behavior, or memory architecture.

### Between-phases pause

Between phases, take a break of at least a few days where the built functionality actually gets used. Do not sprint from M006 to M007 to M008. The whole point of phasing is that real usage tells you things that planning does not. Specifically:

- **M006** should run for at least a week before M007 starts (validate trust fixes in real conversation)
- **M007** should run for at least two weeks before M008 starts (validate decision capture triggers in real use)
- **M009 (MVP)** should run for at least a month before M010 starts (accumulate real daily data so the profile layer has substrate to infer from)

This is not caution — it is architectural necessity. Consolidation logic for memory tiers cannot be designed from data that does not yet exist.

### Phase scoping constraints

Hand every phase these constraints: Do not build features from later phases. Do not refactor things outside this phase's scope. If you discover something that needs fixing in a previous phase, flag it but do not fix it without asking. Ask before making architectural decisions that will affect later phases.

### Use GSD v1

Execution runs inside GSD v1 (`get-shit-done-cc`), not v2. GSD v1 operates as Claude Code skills that read `.planning/PROJECT.md` (symlinked to this PLAN.md) and `.planning/REQUIREMENTS.md`. State lives in markdown files, not a SQLite database, so autocompact mid-workflow does not corrupt state — post-compact Claude can re-read the markdown files and continue.

---

## Current State

**Shipped:** v1.0 (2026-04-13), v2.0 M006 Trustworthy Chris (2026-04-15), v2.1 M007 Decision Archive (2026-04-18), v2.2 M008 Episodic Consolidation (2026-04-19), **v2.3 Test Data Infrastructure (2026-04-20, archived 2026-04-25)**.

v2.3 closed: 20/20 requirements satisfied via Phase 24's primed-fixture pipeline. Operator can produce a fused organic+synthetic test fixture on demand — `scripts/fetch-prod-data.ts` SSH-tunnels into Proxmox for read-only pg_dump, `scripts/synthesize-delta.ts` extends with Haiku style-transfer + deterministic generators (VCR-cached for free re-runs), `scripts/synthesize-episodic.ts` invokes the real `runConsolidate()` engine via sibling-module composition against throwaway PG5435, and `loadPrimedFixture(name)` seeds the Docker test DB FK-safe + idempotent. HARN-03 sanity gate asserts ≥7 summaries, ≥200 telegram entries, UNIQUE(summary_date), no non-telegram leakage. D041 convention codified in PLAN.md/CONVENTIONS.md/TESTING.md: *no milestone may gate on real calendar time for data accumulation.*

Chris is deployed on self-hosted Proxmox (192.168.1.50) with both containers healthy through v2.2. v2.3 is a test-infrastructure milestone — no prod deploy expected; the new scripts run from operator workstations against prod read-only.

**Currently between milestones.** M009 Ritual Infrastructure is unblocked and is the next planned milestone — the primed-fixture pipeline removes the prior 7-real-calendar-day data-accumulation gate. Kickoff command: `/gsd-new-milestone "M009 Ritual Infrastructure + Daily Note + Weekly Review"`.

**Tech debt carried into v2.4+:**
- **Process: `gsd-verifier` not wired into `/gsd-execute-phase`.** Phase 24 shipped without a live VERIFICATION.md (produced retroactively at v2.3 close). Investigate before next milestone.
- **Process: SUMMARY.md frontmatter missing `requirements-completed` field.** All 4 v2.3 plans omit it — breaks structured cross-reference. Update template / planner prompt before next milestone.
- **Upstream `gsd-sdk milestone.complete` is broken** — calls `phasesArchive([], projectDir)` without forwarding the version arg. v2.3 close performed manually as workaround.
- **Manual operator UAT pending for v2.3 live prod path** — `scripts/regenerate-primed.ts --milestone m008 --force` against real Proxmox needs to run once to materialize `tests/fixtures/primed/m008-14days/MANIFEST.json`; HARN-03 4 sanity assertions then flip from skipped to running.
- **Env-level vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing; 5-file excluded-suite mitigation in `scripts/test.sh` keeps Docker gate green. Worth a future fix-up phase.
- **`getEpisodicSummariesRange` forward-only substrate** — exported and tested but zero production callers in v2.2/v2.3. Will be picked up by M009 weekly review.
- **Phase 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
- **12 human-UAT items carried from v2.1** — live Telegram feel, ACCOUNTABILITY tone, `/decisions` dashboard format, FR/RU localization.

Archived detail: `.planning/milestones/v2.0-*`, `.planning/milestones/v2.1-*`, `.planning/milestones/v2.2-*`, `.planning/milestones/v2.3-*`, `.planning/milestones/v2.X-phases/` (phase directories for v2.0–v2.2; v2.3 phase archival pending).

## Current Milestone: v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review *(MVP shipping point)*

**Goal:** Build scheduling + tracking infrastructure for rituals plus the three lightest rituals — daily journal, daily wellbeing snapshot, weekly review. After M009 ships, Greg has the full frictionless reflection loop: M006 trust + M007 decisions + M008 episodic + M009 daily prompts + weekly observations. Everything from M010 onward builds on real data this milestone produces.

**Target features:**
- New `rituals` table (id, type enum daily/weekly/monthly/quarterly, last_run_at, next_run_at, enabled, config jsonb, skip_count, created_at)
- New `wellbeing_snapshots` table (id, snapshot_date, energy/mood/anxiety 1–5, notes, created_at)
- Proactive sweep extended to fire `rituals` whose `next_run_at` has passed (reactive triggers coexist)
- Skip-tracking adjustment dialogue (3 consecutive skips → "what should change?" Haiku-parsed; `rituals.config` updated)
- Daily journal ritual — 6 rotating prompts, no consecutive duplicates, deposit-only (Chris does NOT respond)
- Daily wellbeing snapshot — 3-row Telegram inline keyboard, no LLM analysis on deposit, optional skip without adjustment dialogue
- Weekly review (Sunday evening, configurable) — exactly **one** observation + **one** Socratic question from M008 episodic + M007 resolved decisions; multi-question outputs rejected and regenerated at runtime
- 14-day synthetic-fixture test asserting all 7 ritual behaviors via mock clock + primed-fixture pipeline (D041)
- Carry-ins (folded into v2.4 scope):
  - **Process gate** — wire `gsd-verifier` into `/gsd-execute-phase` so future phases can't ship without VERIFICATION.md; update SUMMARY.md template to emit `requirements-completed` frontmatter
  - **HARN-03 fixture refresh** — refresh primed fixture against fresh prod data with `--target-days 21` (or relax thresholds) so the M009 14-day fixture test has ≥7 summaries / ≥200 entries

**Key context:**
- **D041 supersedes M009 spec's "1 month real daily use before M010" pause** — M010 validates via primed-fixture pipeline, not calendar wait.
- **Recency-window symptom** ("feels like we didn't talk since yesterday") was fixed 2026-04-25 by date-extraction Haiku JSON-fences fix, not a v2.4 phase.
- **D029/D030/D034/D035/D036 in force.** Weekly review reads via `retrieveContext` two-dim routing (D036).

**Kickoff command:** `/gsd-new-milestone "M009 Ritual Infrastructure + Daily Note + Weekly Review"` (in progress).

<details>
<summary>v2.3 Test Data Infrastructure (shipped 2026-04-20, archived 2026-04-25 — historical)</summary>

**Goal:** Pre-M009 enabler. Build the organic+synthetic primed-fixture pipeline so every downstream milestone (M009–M014) can be validated on demand without real-calendar-time data-accumulation gates.

**Delivered (20/20 requirements, 1 phase, 4 plans):**
- `scripts/fetch-prod-data.ts` SSH-tunneled 9-table dump from Proxmox (FETCH-01..05) + `autoRefreshIfStale` 24h auto-refresh helper (FRESH-01) + Mulberry32 seeded RNG + Fisher-Yates shuffle (Plan 24-01)
- `src/__tests__/fixtures/vcr.ts` content-addressable SHA-256 Anthropic SDK wrapper + `scripts/synthesize-delta.ts` 700-LOC CLI with per-day Haiku style-transfer + deterministic decisions/contradictions/wellbeing generators + `--no-refresh` flag + deterministic UUID generator (SYNTH-01..07 + FRESH-02; Plan 24-02)
- `scripts/synthesize-episodic.ts` 536-LOC sibling-module composition against throwaway PG5435 invoking real `runConsolidate()` (SYNTH-03; Plan 24-03)
- `loadPrimedFixture(name)` FK-safe + idempotent test-harness loader (HARN-01/02) + HARN-03 4-invariant sanity gate (≥7 summaries, ≥200 telegram entries, UNIQUE(summary_date), no non-telegram leakage) + `scripts/regenerate-primed.ts` 256-LOC pure composer (FRESH-03) + TESTING.md/CONVENTIONS.md/PLAN.md D041 convention codification (DOC-01/02; Plan 24-04)

**New decisions logged during v2.3:** D041 (test data via primed-fixture pipeline; no calendar-time data-accumulation gates).

**Audit:** initially `gaps_found` (audit-trail artifacts missing); remediated 2026-04-24 — 24-VERIFICATION.md produced via gsd-verifier, 24-VALIDATION.md flipped to nyquist_compliant, REQUIREMENTS.md checkboxes corrected. Re-audit `passed`.

Archived at `.planning/milestones/v2.3-ROADMAP.md`, `.planning/milestones/v2.3-REQUIREMENTS.md`, `.planning/milestones/v2.3-MILESTONE-AUDIT.md`.

</details>

<details>
<summary>v2.2 M008 Episodic Consolidation (shipped 2026-04-19 — historical)</summary>

**Goal:** Add a second memory tier above the Pensieve raw store — end-of-day episodic summaries that compress each day's entries into a structured narrative with importance scoring. Foundation for M009 weekly review (which needs daily summaries as substrate) and M010+ profile inference (which need consolidated episodes, not raw entries).

**Delivered (35/35 requirements, 5 phases, 17 plans):**
- `episodic_summaries` schema (migration 0005: 8 cols + `UNIQUE(summary_date)` + `GIN(topics)` + `btree(importance)`) + Zod 3-layer type chain + `config.episodicCron` (Phase 20, 3 plans)
- `runConsolidate` end-to-end with preamble + 4-band rubric + runtime importance floors (≥6 for real decisions, ≥7 for contradictions) + verbatim-quote enforcement + sparse-entry guard + Telegram error notify (Phase 21, 4 plans, all 12 CONS requirements)
- Independent DST-safe cron at 23:00 local + `retrieveContext` two-dim routing + INTERROGATE date-anchored injection + boundary audit RETR-05/06 (Phase 22, 5 plans, all 8 RETR/CRON requirements)
- Gap-closure decimal Phase 22.1 wiring `retrieveContext` into 5 chat-mode handlers via `hybridOptions` passthrough + `summaryToSearchResult` adapter + 15 regression tests (Phase 22.1, 1 plan)
- 14-day synthetic fixture (TEST-15..21: Pearson r > 0.7, routing branches a/b/c/d, DST 2026-03-08 PST→PDT, idempotency, decision floor, contradiction dual-position) + `scripts/backfill-episodic.ts` operator script (OPS-01) + `/summary [YYYY-MM-DD]` Telegram command (CMD-01) + TEST-22 live anti-flattery 3-of-3 atomic against real Sonnet — zero flattery markers (Phase 23, 4 plans)

**New decisions logged during v2.2:** D034 (8-column schema locked + indexes in 0005 not retrofitted), D035 (Pensieve authoritative, episodic is projection), D036 (2D routing: recency + query intent), D037 (INTERROGATE bypass intentional), D038 (TEST-22 empirical proof preamble works in cron), D039 (no Haiku fallback in verbatim fast-path — M008 deferral), D040 (decimal phases are gap-closure pattern).

Archived at `.planning/milestones/v2.2-ROADMAP.md`, `.planning/milestones/v2.2-REQUIREMENTS.md`, `.planning/milestones/v2.2-MILESTONE-AUDIT.md`, `.planning/milestones/v2.2-INTEGRATION-CHECK.md`.

</details>

<details>
<summary>v2.0 M006 Trustworthy Chris (shipped 2026-04-15 — historical)</summary>

**Goal:** Fix four trust-breaking conversational failures and harden Chris with constitutional anti-sycophancy + structured fact retrieval before any soul-system work is layered on top.

**Delivered:**
- Refusal handling in all 6 system prompts + per-session declined-topics state (Phase 7)
- JOURNAL mode upgraded to hybrid retrieval with FACT/RELATIONSHIP/PREFERENCE/VALUE tags (Phase 8, 11)
- Language detection via `franc` as engine pre-processing with short-message threshold (Phase 7)
- Question-pressure reduced in JOURNAL prompt (Phase 7)
- Constitutional anti-sycophancy preamble + The Hard Rule + 3 forbidden behaviors (Phase 7)
- Praise quarantine — Haiku post-processor for JOURNAL/REFLECT/PRODUCE (Phase 9)
- Structured fact injection — "Facts about you (Greg)" key-value block (Phase 8, 11)
- 24-case live integration test suite, 3-of-3 against real Sonnet (Phase 10)
- Contradiction detection false-positive audit, 0 FP on 20 adversarial pairs (Phase 10)
- Memory audit against ground truth (Phase 6)
- Identity grounding: John→Greg unification (Phase 11)
- Tech-debt closure: residual rename + SUMMARY frontmatter backfill (Phase 12)

</details>

<details>
<summary>v2.1 M007 Decision Archive (shipped 2026-04-18 — historical)</summary>

**Goal:** Capture every structural decision Greg makes with reasoning and a falsifiable forecast, surface the forecast at its resolution date, and run a post-mortem — converting Chris from reflective journal into epistemic accountability tool.

**Delivered (31/31 requirements):**
- Schema & lifecycle primitives: append-only `decision_events` + `decisions` projection + `decision_capture_state`; `transitionDecision()` chokepoint with optimistic concurrency and 3 distinguishable error classes; replayable projection via `regenerateDecisionFromEvents()` (Phase 13)
- Capture flow: EN/FR/RU two-phase trigger (regex + Haiku `trivial`/`moderate`/`structural` stakes); conversational 5-slot Haiku extraction with 3-turn cap + abort phrases; `parseResolveBy` with 7/30/90/365-day fallback ladder; engine PP#0/PP#1 pre-processors; `/decisions suppress` persistence (Phase 14)
- Dual-channel proactive sweep: fifth `decision-deadline` trigger at priority 2; `reflective_outreach` / `accountability_outreach` channels with independent daily caps; dated stale-context ≥48h; write-before-send via `upsertAwaitingResolution` (Phases 15 + 19)
- ACCOUNTABILITY mode + resolution + post-mortem: new mode bypasses praise quarantine and forbids The Hard Rule (D027); `handleResolution` → `classifyOutcome` (Haiku, fail-closed) → `handlePostmortem`; ±48h `getTemporalPensieve` context; Popper criterion redisplay; auto-escalation after 48h silence (Phases 16 + 19)
- `/decisions` command + accuracy stats: 8 sub-commands pull-only; 2-axis Haiku classification cached at resolution time with model version; N≥10 Wilson 95% CI floor; SQL `FILTER` rolling 30/90/365-day windows; domain-tag breakdown; `/decisions reclassify` (Phase 17)
- Synthetic fixture + live suite: single `vi.setSystemTime` 14-day lifecycle (TEST-10); concurrency race (TEST-11); channel-separation collision (TEST-12); live ACCOUNTABILITY 3-of-3 (TEST-13, API-gated); vague-validator live resistance (TEST-14, API-gated) (Phase 18)
- Proactive pipeline restoration: byte-exact restore of `state.ts`/`prompts.ts`/`sweep.ts` from canonical `4c156c3` (lost in worktree merge `5582442`); TEST-12 realigned to channel-separation contract; Phase 15/16 `VERIFICATION.md` re-aligned with runtime code (Phase 19)

**Tech debt carried:** TECH-DEBT-19-01 (drizzle-kit meta snapshots for migrations 0001/0003) + 3 Phase 13 Info deferrals documented `Fix: None required` + 12 human-UAT items + TEST-13 / TEST-14 live-API runs pending `ANTHROPIC_API_KEY`.

**New decisions logged during v2.1:** D-04 decision lifecycle map (legal transitions + open-draft/stale/abandoned terminal set); D-07 legacy-key reflective fallback; D-14 vague-prediction one-pushback invariant; D-17 pre-regex suppression check; D-18 live ACCOUNTABILITY 3-of-3 against real Sonnet; D-25 abort-phrase detection inside PP#0; D-28 write-before-send ordering for sweep.

</details>

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-11 after v2.4 M009 milestone close (23 plans, 52/52 requirements, 6 phases + Phase 31 terminology cleanup + Phase 32 substrate hardening). Full PROJECT.md evolution (What This Is / Core Value / Requirements / Out of Scope / Key Decisions / Constraints review) is deferred to v2.5 M010 kickoff via `/gsd-new-milestone`, which drives the deeper update with fresh domain questions.*
