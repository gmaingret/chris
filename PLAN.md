# Project Chris — Implementation Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Docker Host (Proxmox <PROXMOX_HOST>)               │
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
│                │  └─────────────────────┘  │  │ • proactive_state │ │
│                │                           │  │ • sync_status     │ │
│                │  ┌─────────────────────┐  │  │ • oauth_tokens    │ │
│                │  │  Proactive Sweep     │  │  └───────────────────┘ │
│                │  │  Cron + Opus triggers │  │                       │
│                │  └─────────────────────┘  │  ┌───────────────────┐ │
│                │                           │  │     Volumes        │ │
│                │  ┌─────────────────────┐  │  │  • pgdata          │ │
│                │  │  Source Sync Cron    │  │  └───────────────────┘ │
│                │  │  Gmail/Immich/Drive  │  │                       │
│                │  └─────────────────────┘  │                       │
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
| **Container** | Docker Compose | Single-host deployment on Proxmox |

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
- [x] Docker Compose deployment on Proxmox <PROXMOX_HOST>
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

## Deferred Requirements (11)

These are implemented but their validation text in REQUIREMENTS.md was written before M002–M004 code was merged to main. The code exists on the deployed server and is now synced locally. Most need their status updated from "deferred" to "validated" with current evidence.

| ID | Requirement | Status | Notes |
|----|-------------|--------|-------|
| R014 | Reflect mode — pattern synthesis | deferred | **Implemented** (src/chris/modes/reflect.ts, 22 tests) |
| R015 | Produce mode — thinking partner | deferred | **Implemented** (src/chris/modes/produce.ts, 19 tests) |
| R016 | Coach mode — challenge + pushback | deferred | **Implemented** (src/chris/modes/coach.ts, 21 tests) |
| R017 | Psychology mode — depth analysis | deferred | **Implemented** (src/chris/modes/psychology.ts, 21 tests) |
| R018 | Contradiction detection | deferred | **Implemented** (src/contradiction/detector.ts, 20 tests) |
| R019 | Relational memory | deferred | **Implemented** (src/memory/relational.ts, 16 tests) |
| R020 | Gmail ingestion | deferred | **Implemented** on server (M003), needs merge verification |
| R021 | Immich photo metadata | deferred | **Implemented** on server (M003), needs merge verification |
| R024 | Proactive Chris | deferred | **Implemented** on server (M004), needs merge verification |
| R025 | Voice message transcription | deferred | Not implemented — no Whisper integration yet |
| R026 | Photo message handling | deferred | Not implemented — no vision/image handling yet |

---

## Key Patterns

- **Fire-and-forget** for tagging, embedding, relational memory (never block response)
- **Engine orchestrator** — detect mode → route to handler → post-processing (contradiction, relational) → save
- **Three-tier LLM** — Haiku classify, Sonnet converse, Opus deep analysis
- **Two-phase trigger execution** — cheap SQL gates expensive Opus calls
- **Source pipeline** — client → metadata converter → sync orchestrator → command handler
- **Never-throw contract** — side-effects (tagging, embedding, contradiction, relational) log errors and swallow

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| **Data loss** | PostgreSQL WAL + append-only design; persistent Docker volume |
| **API costs** | Haiku for cheap ops; Opus gated behind SQL triggers; local embeddings |
| **Latency** | Async tagging/embedding; 3s contradiction timeout; conversation history capped at 20 |
| **Hallucination** | System prompts forbid ungrounded facts; retrieval citations required; explicit uncertainty flags |
| **False positive contradictions** | Confidence threshold ≥ 0.75; high bar in detection prompt |

---

## Current State

All 5 milestones complete. Chris is deployed and running on Proxmox <PROXMOX_HOST>. 285 tests passing across 16 test files. Both containers healthy.
