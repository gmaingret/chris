# Project Chris — Implementation Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Host (Proxmox)                     │
│                     192.168.1.50                             │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Telegram  │  │   Chris      │  │      PostgreSQL        │ │
│  │ Bot API   │──│   App        │──│  + pgvector extension  │ │
│  │ (webhook  │  │  (Node.js)   │  │                        │ │
│  │  or poll) │  │              │  │  • pensieve (verbatim) │ │
│  └──────────┘  │  ┌─────────┐ │  │  • relational_memory   │ │
│                │  │ Chris   │ │  │  • embeddings          │ │
│                │  │ Engine  │ │  │  • conversations       │ │
│                │  └─────────┘ │  └────────────────────────┘ │
│                │              │                              │
│                │  ┌─────────┐ │  ┌────────────────────────┐ │
│                │  │ Epistem.│ │  │     Volumes            │ │
│                │  │ Tagger  │ │  │  • pg_data             │ │
│                │  └─────────┘ │  │  • chris_backups       │ │
│                └──────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Node.js 22 + TypeScript | Fast iteration, strong Telegram/LLM ecosystem |
| **Database** | PostgreSQL 16 + pgvector | Relational + vector search in one DB; append-only pensieve; battle-tested |
| **LLM** | Anthropic Claude API (claude-sonnet-4-20250514) | Best reasoning, longest context, instruction-following for persona fidelity |
| **Embeddings** | Voyage AI (voyage-3) or OpenAI text-embedding-3-small | High-quality embeddings for semantic retrieval |
| **Telegram** | grammy (Telegram bot framework) | Modern, TypeScript-native, middleware-based, well-maintained |
| **ORM** | Drizzle ORM | Type-safe, lightweight, great migration story |
| **Container** | Docker Compose | Single-host deployment on Proxmox |

---

## Database Schema Design

### Table: `pensieve_entries` (Layer 1 — The Sacred Store)
Greg's raw life memory. **Append-only. Never modified silently.**

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `content` | TEXT | **Verbatim** input from Greg — never summarized |
| `epistemic_tag` | ENUM | FACT, EMOTION, BELIEF, INTERPRETATION, IDEA, DECISION |
| `source` | VARCHAR | 'telegram', 'gmail', 'photos', 'document_import' |
| `source_message_id` | VARCHAR | Telegram message ID or external ref |
| `created_at` | TIMESTAMPTZ | When deposited |
| `event_date` | TIMESTAMPTZ | When the event *happened* (may differ from deposit time) |
| `superseded_by` | UUID | FK → self. Set when a belief/decision is updated |
| `is_deleted` | BOOLEAN | Soft-delete only, requires explicit command |
| `metadata` | JSONB | Flexible: linked photos, locations, people mentioned, etc. |

### Table: `pensieve_embeddings`
Vector representations for semantic search.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `entry_id` | UUID | FK → pensieve_entries |
| `embedding` | vector(1024) | pgvector column |
| `model` | VARCHAR | Which embedding model produced this |
| `created_at` | TIMESTAMPTZ | |

### Table: `relational_memory` (Layer 2 — Chris's Own Memory)
What Chris has observed, concluded, and tracked about Greg over time.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `type` | ENUM | PATTERN, CONCLUSION, DYNAMIC, OBSERVATION |
| `content` | TEXT | Chris's own synthesis |
| `source_entry_ids` | UUID[] | Which pensieve entries support this |
| `confidence` | FLOAT | 0.0–1.0 how confident Chris is |
| `created_at` | TIMESTAMPTZ | |
| `superseded_by` | UUID | FK → self, for evolving patterns |

### Table: `conversations`
Conversation history for context continuity.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `telegram_chat_id` | BIGINT | |
| `role` | ENUM | 'greg', 'chris' |
| `content` | TEXT | |
| `mode` | ENUM | JOURNAL, INTERROGATE, REFLECT, PRODUCE, COACH, PSYCHOLOGY |
| `created_at` | TIMESTAMPTZ | |
| `pensieve_entry_id` | UUID | FK if this message created a pensieve entry |

### Table: `contradictions`
Tracked contradictions between entries.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `entry_old_id` | UUID | FK → pensieve_entries |
| `entry_new_id` | UUID | FK → pensieve_entries |
| `status` | ENUM | UNRESOLVED, RESOLVED, SUPERSEDED, FLAGGED |
| `resolution_note` | TEXT | How Greg chose to handle it |
| `created_at` | TIMESTAMPTZ | |

---

## Application Architecture

### Module Breakdown

```
src/
├── index.ts                  # Entry point — starts bot + services
├── config.ts                 # Environment config with validation
│
├── bot/
│   ├── bot.ts                # Grammy bot setup, middleware chain
│   ├── handlers/
│   │   ├── message.ts        # Main message handler — routes to modes
│   │   ├── commands.ts       # /start, /mode, /search, /stats, /delete
│   │   └── voice.ts          # Voice message handling (future)
│   └── middleware/
│       ├── auth.ts           # Only Greg can talk to Chris
│       └── rateLimit.ts      # Prevent accidental floods
│
├── chris/
│   ├── engine.ts             # Core Chris logic — mode detection, response gen
│   ├── personality.ts        # System prompt builder from pensieve context
│   ├── modes/
│   │   ├── journal.ts        # Receive + store + optional follow-up
│   │   ├── interrogate.ts    # Search pensieve, cite sources
│   │   ├── reflect.ts        # Pattern synthesis across full history
│   │   ├── produce.ts        # Forward-looking thinking partner
│   │   ├── coach.ts          # Challenge patterns, surface blind spots
│   │   └── psychology.ts     # Deep analysis, archetypes, shadow work
│   └── contradiction.ts      # Detect + surface contradictions
│
├── pensieve/
│   ├── store.ts              # Append-only write to pensieve_entries
│   ├── retrieve.ts           # Hybrid search: semantic + keyword + temporal
│   ├── tagger.ts             # Epistemic auto-tagging via LLM
│   └── embeddings.ts         # Generate + store embeddings
│
├── memory/
│   ├── relational.ts         # Chris's own memory CRUD
│   └── context-builder.ts    # Build relevant context window for any query
│
├── llm/
│   ├── client.ts             # Anthropic API client
│   ├── prompts.ts            # System prompts for each mode
│   └── streaming.ts          # Streaming response handler
│
├── db/
│   ├── connection.ts         # PostgreSQL connection pool
│   ├── schema.ts             # Drizzle schema definitions
│   └── migrations/           # Drizzle migrations
│
└── utils/
    ├── logger.ts             # Structured logging
    └── errors.ts             # Error types
```

### Key Design Decisions

#### 1. Mode Detection (Automatic)
Chris detects the interaction mode from the message itself — no manual mode switching needed:
- **Journal**: Messages starting with "Chris," or casual deposits → store + acknowledge
- **Interrogate**: Questions about self ("have I ever...", "what do I think about...")
- **Reflect**: Requests for patterns ("what are my...", "how have I changed...")
- **Produce**: Forward-looking ("help me plan...", "brainstorm...", "what should I...")
- **Coach**: Challenges/decisions ("I'm stuck on...", "I keep doing...", "should I...")
- **Psychology**: Deep analysis requests ("analyze my...", "what's my pattern with...")

The LLM classifies the mode as part of the initial processing step.

#### 2. Retrieval Strategy (Hybrid)
For every non-journal interaction, Chris builds a context window:
1. **Semantic search**: Embed the query → find top-K similar pensieve entries via pgvector
2. **Keyword/entity search**: Full-text search for named entities, dates, topics
3. **Temporal weighting**: Recent entries get a slight boost, but old entries are never excluded
4. **Relational memory**: Always include relevant Chris observations/patterns
5. **Conversation history**: Last N messages for continuity

Context window is capped at ~80K tokens to leave room for Chris's response.

#### 3. Epistemic Tagging
Every incoming message is tagged by a lightweight LLM call:
- Input: the raw message
- Output: one of FACT, EMOTION, BELIEF, INTERPRETATION, IDEA, DECISION
- Runs asynchronously after storage (storage is never blocked by tagging)
- Tag is written back to the pensieve entry

#### 4. Contradiction Detection
After each new entry is stored and tagged:
- Semantic search for potentially contradicting entries (same topic, different stance)
- If found, flag and surface to Greg in the response
- Greg chooses: resolve, leave unresolved, or defer

#### 5. Auth Model
- Single authorized Telegram user ID (Greg's)
- All other messages are silently ignored
- No multi-user support needed or planned

---

## Docker Deployment

### Services

```yaml
services:
  chris:
    build: .
    restart: unless-stopped
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    volumes:
      - pg_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: chris
      POSTGRES_USER: chris
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U chris"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pg_data:
```

### Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `TELEGRAM_BOT_TOKEN` | Telegram bot authentication |
| `TELEGRAM_AUTHORIZED_USER_ID` | Greg's Telegram user ID (auth gate) |
| `POSTGRES_PASSWORD` | Database password |
| `EMBEDDING_API_KEY` | For embedding model (Voyage or OpenAI) |
| `EMBEDDING_PROVIDER` | 'voyage' or 'openai' |

---

## Implementation Phases

### Phase 1 — Foundation (MVP)
Get Chris talking on Telegram with persistent memory.

- [x] Project scaffolding (TS, Docker, DB)
- [ ] PostgreSQL + pgvector setup
- [ ] Drizzle schema + migrations
- [ ] Telegram bot (grammy) with auth middleware
- [ ] Pensieve store (append-only write)
- [ ] Epistemic auto-tagger
- [ ] Basic retrieval (semantic search)
- [ ] Chris engine — Journal mode
- [ ] Chris engine — Interrogate mode
- [ ] LLM integration (Claude) with system prompt
- [ ] Docker Compose deployment
- [ ] Conversation history persistence

### Phase 2 — Depth
Make Chris genuinely useful as an advisor.

- [ ] Reflect mode (pattern synthesis)
- [ ] Produce mode (thinking partner)
- [ ] Coach mode (challenge + surface patterns)
- [ ] Psychology mode (deep analysis)
- [ ] Contradiction detection + resolution flow
- [ ] Relational memory (Chris's own observations)
- [ ] Improved retrieval (hybrid: semantic + keyword + temporal)
- [ ] Context window optimization

### Phase 3 — External Sources
Connect Greg's digital life.

- [ ] Gmail ingestion via API
- [ ] Google Photos metadata ingestion
- [ ] Document import (PDF, text files via Telegram)
- [ ] Source provenance tracking

### Phase 4 — Proactive Chris (V2)
Chris reaches out when patterns warrant it.

- [ ] Silence detection
- [ ] Pattern recurrence alerts
- [ ] Commitment tracking
- [ ] Unresolved thread surfacing

---

## Risk Mitigations

| Risk | Mitigation |
|------|------------|
| **Data loss** | PostgreSQL WAL + daily pg_dump backups to a separate volume |
| **API costs** | Cache embeddings; use sonnet (not opus) for tagging; stream responses |
| **Latency** | Async tagging; pre-built context caches for common queries |
| **Context overflow** | Smart retrieval caps; summarize conversation history beyond N turns |
| **Hallucination** | System prompt strictly forbids stating ungrounded facts; retrieval citations required |

---

## Next Step
Collect required API keys (Anthropic, Telegram Bot Token, Greg's User ID, Embedding provider) and begin Phase 1 implementation.
