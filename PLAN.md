# Project Chris — Implementation Plan

This is the single source of truth for Project Chris. It contains the project context, architectural constraints, key decisions, and the full milestone roadmap. `.planning/PROJECT.md` is a symlink to this file so GSD v1 skills can find it at the expected path while reading the same content.

## What This Is

Chris is a personal AI entity for a single user (Greg), running as a self-hosted Telegram bot. He is a **Pensieve**: an append-only, verbatim store of Greg's memories, thoughts, emotions, ideas, and decisions, paired with semantic retrieval that makes the accumulated memory actively useful. Chris stores silently, responds naturally, and speaks as a first-person entity whose personality emerges from the data rather than from hardcoded prompts. He never flatters, never hallucinates, and always sources claims from the Pensieve.

## Core Value

Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.

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
| **D026** | Daily wellbeing snapshot is separate from the daily voice note | The voice note is deposit-only narrative (RIT-04). The wellbeing snapshot (RIT-06) is three numeric taps (energy/mood/anxiety, 1–5 each). Combining them would either bloat the voice note ritual with structured questions or pollute the numeric series with interpretation. Keeping them separate preserves the frictionlessness of each. |
| **D027** | The Hard Rule: Chris never tells Greg he is right because of who he is | The trap of personal AI is that the better the system knows the user, the more it can construct flattery that feels like insight. Appeals to Greg's past track record as evidence for current claims are forbidden entirely (TRUST-08). Every claim is evaluated on its own merits. |
| **D028** | Attachment dimensions profile is deferred with an automatic activation trigger | Below 2,000 words of relational speech over 60+ days, the profile returns "insufficient data" (ATTACH-01). Inferring attachment from sparse data produces stereotypes worse than no profile. Weekly sweep monitors threshold; when crossed, profile activates without manual intervention. |
| **D029** | Execution order prioritizes MVP (M006→M007→M008→M009) ahead of the profile layer | Per the PRD's "start with decision archive + daily voice note" principle, M009 (ritual infrastructure + daily note + weekly review) executes immediately after M008 episodic consolidation, before any profile milestone. Daily voice note and weekly review only need M008 summaries and M007 decisions; neither requires profile inference. Shipping M009 early delivers real user value and starts the daily data accumulation that M010–M012 profile inference actually requires. |
| **D030** | Weekly review ships in M009, not M013 | Weekly review (RRIT-01) only depends on M008 episodic summaries and M007 resolved decisions — no profile layer required. Shipping it as part of M009 completes the reflection cadence as part of the MVP (daily + weekly) instead of gating the weekly loop behind months of profile buildup. Monthly and quarterly rituals remain in M013 because monthly reconciliation requires Schwartz values (M011) and quarterly Butler review benefits from all profiles (M010/M011/M012). |
| **D031** | Memory retrieval injects structured facts, not prose dump | Real Telegram testing showed Chris confabulating facts (Cagnes-sur-Mer vs Golfe-Juan, wrong move direction) because memory was dumped as prose text into the context window. TRUST-11 refactors retrieval to emit a "Known Facts About Greg" block in key-value form, separate from the narrative context block. Structured facts are much harder for the LLM to misremix. |
| **D032** | Hallucination resistance and performative apology detection are live integration tests, not unit tests | Both failure modes are prompt-level behaviors that only manifest against real Sonnet. TRUST-07 extends from 15 test cases to 24 (adding hallucination resistance, structured fact retrieval accuracy, performative apology detection). Mocked LLM tests cannot catch these failures because they depend on how the real model interprets the system prompt under adversarial conditions. |
| **D033** | Contradiction detection gets an explicit false-positive audit | The existing M002 confidence threshold (≥0.75) minimizes false positives but doesn't test them. TRUST-12 adds a synthetic fixture of 20 adversarial non-contradictory pairs and requires 0 false positives. False positive contradiction notices are trust-breaking and must be actively tested, not assumed. |

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

| # | ID | Name | Depends on |
|---|----|------|------------|
| 1 | M006 | Trustworthy Chris ⚠️ URGENT | M005 |
| 2 | M007 | Decision Archive | M006 |
| 3 | M008 | Episodic Consolidation | M007 |
| 4 | **M009** | **Ritual Infrastructure + Daily Note + Weekly Review** *(MVP shipping point)* | M008 |
| 5 | M010 | Operational Profiles | M009 |
| 6 | M011 | Psychological Profiles | M010 |
| 7 | M012 | Mental Model Inventory | M010 (parallel with M011) |
| 8 | M013 | Monthly + Quarterly Rituals + Anti-Sycophancy Monitoring | M011 and M012 |
| 9 | M014 | Narrative Identity | M013 |

**M009 is the MVP shipping point.** After M006→M007→M008→M009, Greg has refusal-respecting Chris with constitutional anti-sycophancy, decision capture with forecasts, episodic summaries, daily voice note, daily wellbeing snapshot, and weekly review. Profile layer (M010–M012) consumes the real data M009 produces — running it earlier produces empty profiles with no inference to make.

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

**Shipped:** v1.0 (2026-04-13), v2.0 M006 Trustworthy Chris (2026-04-15).

All 26 v2.0 requirements satisfied with code + live-suite evidence. Chris is deployed on self-hosted Proxmox (192.168.1.50) with both containers healthy. Four trust-breaking failures observed on 2026-04-11 (refusal ignoring, fact confabulation, performative apologies, question pressure) are closed. Constitutional anti-sycophancy preamble, `franc`-based language detection, JOURNAL hybrid retrieval with structured Known Facts block, Haiku praise quarantine, 24-case live integration suite, and 20-pair contradiction FP audit are all in place. Identity grounding ("Greg" in all user-facing prompts) unified after Phase 10 surfaced a TEST-03 regression.

Zero tech debt carried into v3.0.

Archived detail: `.planning/milestones/v2.0-ROADMAP.md`, `.planning/milestones/v2.0-REQUIREMENTS.md`, `.planning/milestones/v2.0-MILESTONE-AUDIT.md`.

## Next Milestone

Per the soul-system execution order (see "Implementation Phases" below), next up is **M007 Decision Archive**. Start with `/gsd-new-milestone`. Per the between-phases pause discipline, M006 should run for at least a week in real use before M007 starts — validate trust fixes against real conversation before layering new scope.

<details>
<summary>v2.0 M006 Trustworthy Chris (shipped — historical)</summary>

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
*Last updated: 2026-04-15 after v2.0 M006 Trustworthy Chris milestone shipped*
