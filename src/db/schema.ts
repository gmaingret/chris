import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  jsonb,
  timestamp,
  real,
  bigint,
  integer,
  index,
  unique,
  check,
  date,
} from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Enums ──────────────────────────────────────────────────────────────────

export const epistemicTagEnum = pgEnum('epistemic_tag', [
  'FACT',
  'EMOTION',
  'BELIEF',
  'INTENTION',
  'EXPERIENCE',
  'PREFERENCE',
  'RELATIONSHIP',
  'DREAM',
  'FEAR',
  'VALUE',
  'CONTRADICTION',
  'OTHER',
  'DECISION',
]);

export const relationalMemoryTypeEnum = pgEnum('relational_memory_type', [
  'PATTERN',
  'OBSERVATION',
  'INSIGHT',
  'CONCERN',
  'EVOLUTION',
]);

export const conversationRoleEnum = pgEnum('conversation_role', [
  'USER',
  'ASSISTANT',
]);

export const conversationModeEnum = pgEnum('conversation_mode', [
  'JOURNAL',
  'INTERROGATE',
  'REFLECT',
  'PRODUCE',
  'COACH',
  'PSYCHOLOGY',
  'PHOTOS',
]);

export const contradictionStatusEnum = pgEnum('contradiction_status', [
  'DETECTED',
  'RESOLVED',
  'ACCEPTED',
]);

export const decisionStatusEnum = pgEnum('decision_status', [
  'open-draft',
  'open',
  'due',
  'resolved',
  'reviewed',
  'withdrawn',
  'stale',
  'abandoned',
]);

export const decisionCaptureStageEnum = pgEnum('decision_capture_stage', [
  'DECISION',
  'ALTERNATIVES',
  'REASONING',
  'PREDICTION',
  'FALSIFICATION',
  'AWAITING_RESOLUTION',
  'AWAITING_POSTMORTEM',
  'DONE',
]);

export const decisionEventTypeEnum = pgEnum('decision_event_type', [
  'created',
  'status_changed',
  'field_updated',
  'classified',
]);

// ── Tables ─────────────────────────────────────────────────────────────────

export const pensieveEntries = pgTable(
  'pensieve_entries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    content: text('content').notNull(),
    epistemicTag: epistemicTagEnum('epistemic_tag'),
    source: varchar('source', { length: 50 }).default('telegram'),
    contentHash: varchar('content_hash', { length: 64 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('pensieve_entries_content_hash_idx').on(table.contentHash),
  ],
);

export const pensieveEmbeddings = pgTable(
  'pensieve_embeddings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => pensieveEntries.id),
    chunkIndex: integer('chunk_index').default(0).notNull(),
    embedding: vector('embedding', { dimensions: 1024 }).notNull(),
    model: varchar('model', { length: 100 }).default('bge-m3'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('pensieve_embeddings_entry_id_idx').on(table.entryId),
    index('pensieve_embeddings_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

export const relationalMemory = pgTable('relational_memory', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  type: relationalMemoryTypeEnum('type').notNull(),
  content: text('content').notNull(),
  supportingEntries: uuid('supporting_entries').array(),
  confidence: real('confidence').default(0.5),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    role: conversationRoleEnum('role').notNull(),
    content: text('content').notNull(),
    mode: conversationModeEnum('mode'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('conversations_chat_id_created_at_idx').on(table.chatId, table.createdAt),
  ],
);

export const oauthTokens = pgTable(
  'oauth_tokens',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: varchar('provider', { length: 50 }).notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiryDate: bigint('expiry_date', { mode: 'number' }),
    scope: text('scope'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('oauth_tokens_provider_unique').on(table.provider),
  ],
);

export const syncStatus = pgTable(
  'sync_status',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    source: varchar('source', { length: 50 }).notNull(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastHistoryId: varchar('last_history_id', { length: 100 }),
    entryCount: integer('entry_count').default(0),
    errorCount: integer('error_count').default(0),
    status: varchar('status', { length: 20 }).default('idle'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('sync_status_source_unique').on(table.source),
  ],
);

export const contradictions = pgTable('contradictions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  entryAId: uuid('entry_a_id').references(() => pensieveEntries.id),
  entryBId: uuid('entry_b_id').references(() => pensieveEntries.id),
  description: text('description').notNull(),
  status: contradictionStatusEnum('status').default('DETECTED'),
  resolution: text('resolution'),
  detectedAt: timestamp('detected_at', { withTimezone: true }).defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

export const proactiveState = pgTable('proactive_state', {
  key: varchar('key', { length: 255 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    status: decisionStatusEnum('status').notNull().default('open-draft'),
    // Content fields (D-08 single reasoning column; D-11 falsification_criterion NOT NULL)
    decisionText: text('decision_text').notNull(),
    alternatives: jsonb('alternatives'),              // Phase 14 writes
    reasoning: text('reasoning').notNull(),
    prediction: text('prediction').notNull(),
    falsificationCriterion: text('falsification_criterion').notNull(),  // LIFE-04
    // Deadlines (D-10 resolve_by NOT NULL timestamptz)
    resolveBy: timestamp('resolve_by', { withTimezone: true }).notNull(),
    // Phase 14 fills (D-09, D-12 — nullable now):
    domainTag: text('domain_tag'),
    languageAtCapture: varchar('language_at_capture', { length: 3 }),  // 'en'/'fr'/'ru'
    // Phase 16 fills (D-12):
    resolution: text('resolution'),
    resolutionNotes: text('resolution_notes'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    // Phase 17 fills (D-12):
    accuracyClass: text('accuracy_class'),
    accuracyClassifiedAt: timestamp('accuracy_classified_at', { withTimezone: true }),
    accuracyModelVersion: varchar('accuracy_model_version', { length: 100 }),
    // Terminal-state denormalized timestamps (D-12):
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    // Audit
    chatId: bigint('chat_id', { mode: 'bigint' }),
    sourceRefId: uuid('source_ref_id'),  // Phase 16 links Pensieve entries back here
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index('decisions_status_resolve_by_idx').on(table.status, table.resolveBy),  // Phase 15 sweep
    index('decisions_chat_id_status_idx').on(table.chatId, table.status),
  ],
);

export const decisionEvents = pgTable(
  'decision_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    decisionId: uuid('decision_id').notNull().references(() => decisions.id),
    eventType: decisionEventTypeEnum('event_type').notNull(),
    fromStatus: decisionStatusEnum('from_status'),  // null for 'created'
    toStatus: decisionStatusEnum('to_status'),      // null for non-status events
    snapshot: jsonb('snapshot').notNull(),          // full decisions row state at this event (D-01)
    actor: varchar('actor', { length: 32 }).notNull(),  // 'capture'|'transition'|'sweep'|'user'|'system'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Tiebreaker for replay determinism when two events share created_at microsecond:
    // DB-side `bigserial NOT NULL` auto-populates on insert; Drizzle reads back via .returning()/.select().
    // .default(nextval(...)) tells TS the column is insert-optional (DB supplies it);
    // NO .generatedAlwaysAsIdentity() — handwritten bigserial was committed in migration 0002.
    sequenceNo: bigint('sequence_no', { mode: 'bigint' })
      .notNull()
      .default(sql`nextval('decision_events_sequence_no_seq'::regclass)`),
  },
  (table) => [
    index('decision_events_decision_id_created_at_sequence_no_idx')
      .on(table.decisionId, table.createdAt, table.sequenceNo),
  ],
);

export const decisionCaptureState = pgTable('decision_capture_state', {
  chatId: bigint('chat_id', { mode: 'bigint' }).primaryKey(),  // PK enforces 1 active flow per chat (D-15)
  stage: decisionCaptureStageEnum('stage').notNull(),
  draft: jsonb('draft').notNull(),
  decisionId: uuid('decision_id'),  // set at AWAITING_RESOLUTION/POSTMORTEM
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Phase 14 CAP-06: per-chat trigger-phrase suppression list.
// Phrases stored trimmed + lowercased by caller (addSuppression helper).
// Unique (chat_id, phrase) enforces idempotent adds; index on chat_id speeds the
// pre-regex suppression lookup in PP#1.
export const decisionTriggerSuppressions = pgTable(
  'decision_trigger_suppressions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    phrase: text('phrase').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('decision_trigger_suppressions_chat_id_idx').on(table.chatId),
    unique('decision_trigger_suppressions_chat_id_phrase_unique').on(table.chatId, table.phrase),
  ],
);

// ── Episodic Consolidation (M008 Phase 20) ─────────────────────────────────

/**
 * EPI-01: episodic_summaries table.
 *
 * Per CONTEXT.md D-07: DB-level CHECK (importance BETWEEN 1 AND 10) is intentional —
 * covers operator paths (OPS-01 backfill, direct psql debugging) not just the Phase 21
 * engine. This deviates from Phase 13's "defer CHECKs to the write-phase" rule with
 * explicit rationale.
 *
 * Per CONTEXT.md D-08: No CHECK on `source_entry_ids` length (CONS-02 entry-count gate
 * prevents zero-entry inserts), no CHECK on `summary` length (Zod EpisodicSummaryInsertSchema
 * enforces min(50)).
 */
export const episodicSummaries = pgTable(
  'episodic_summaries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    summaryDate: date('summary_date').notNull(),
    summary: text('summary').notNull(),
    importance: integer('importance').notNull(),
    topics: text('topics').array().notNull().default(sql`'{}'`),
    emotionalArc: text('emotional_arc').notNull(),
    keyQuotes: text('key_quotes').array().notNull().default(sql`'{}'`),
    sourceEntryIds: uuid('source_entry_ids').array().notNull().default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // EPI-02: all three indexes ship with migration 0005 (non-retrofitted)
    unique('episodic_summaries_summary_date_unique').on(table.summaryDate),
    index('episodic_summaries_topics_idx').using('gin', table.topics),
    index('episodic_summaries_importance_idx').on(table.importance),
    // D-07: DB-level CHECK on importance bounds
    check('episodic_summaries_importance_bounds', sql`${table.importance} BETWEEN 1 AND 10`),
  ],
);
