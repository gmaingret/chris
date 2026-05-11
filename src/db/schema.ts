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
  smallint,
  boolean,
  index,
  unique,
  check,
  date,
} from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
  ProfileSnapshot,
} from '../memory/profiles/schemas.js';

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
  'RITUAL_RESPONSE', // ← Phase 25 RIT-04
]);

export const ritualCadenceEnum = pgEnum('ritual_cadence', [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
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

// ── Rituals (M009 Phase 25) ────────────────────────────────────────────────

/**
 * RIT-01: rituals table — scheduled recurring prompts.
 *
 * `type` is the cadence (ritualCadenceEnum). `next_run_at` is recomputed by
 * scripts/scheduler.ts after each fire/skip via Luxon DST-correct math. The
 * partial index `rituals_next_run_at_enabled_idx` (WHERE enabled=true) is the
 * sweep hot-path lookup — only enabled rituals participate in scheduling.
 *
 * NOTE: FK constraints from event tables → rituals.id are declared in the
 * migration SQL (DO-block idempotency pattern) rather than via Drizzle's
 * `references()`. This matches how decision_events.decision_id references
 * decisions.id without schema.ts using `.references()`.
 */
export const rituals = pgTable(
  'rituals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    type: ritualCadenceEnum('type').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }).notNull(),
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config').notNull().default(sql`'{}'::jsonb`),
    skipCount: integer('skip_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('rituals_name_unique').on(table.name),
    // RIT-05: partial index on enabled rituals only (sweep hot path).
    // FIRST USE of `.where(sql\`...\`)` partial index in this codebase
    // (verified via node_modules/drizzle-orm/pg-core/indexes.d.ts:67).
    index('rituals_next_run_at_enabled_idx')
      .on(table.nextRunAt)
      .where(sql`${table.enabled} = true`),
  ],
);

/**
 * RIT-02: wellbeing_snapshots — daily energy/mood/anxiety captures (1-5 scale).
 *
 * UNIQUE(snapshot_date) enforces one snapshot per day (single-user system).
 * Three CHECK constraints (energy/mood/anxiety BETWEEN 1 AND 5) are DB-level
 * per CONTEXT.md D-07 precedent — covers operator paths (direct psql) not
 * just the Phase 27 capture handler.
 */
export const wellbeingSnapshots = pgTable(
  'wellbeing_snapshots',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    snapshotDate: date('snapshot_date').notNull(),
    energy: smallint('energy').notNull(),
    mood: smallint('mood').notNull(),
    anxiety: smallint('anxiety').notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('wellbeing_snapshots_snapshot_date_unique').on(table.snapshotDate),
    index('wellbeing_snapshots_snapshot_date_idx').on(table.snapshotDate),
    check('wellbeing_snapshots_energy_bounds', sql`${table.energy} BETWEEN 1 AND 5`),
    check('wellbeing_snapshots_mood_bounds', sql`${table.mood} BETWEEN 1 AND 5`),
    check('wellbeing_snapshots_anxiety_bounds', sql`${table.anxiety} BETWEEN 1 AND 5`),
  ],
);

/**
 * RIT-03: ritual_responses — append-only log of ritual prompt fires + replies.
 *
 * `pensieve_entry_id` links to the resulting Pensieve entry (epistemic_tag
 * = 'RITUAL_RESPONSE') if the user replied. `responded_at` NULL = no reply yet.
 * Composite index (ritual_id, fired_at DESC) supports "last N responses for
 * ritual X" lookups (Phase 26 PP#5 detector).
 *
 * FK pattern follows decision_events precedent: `.references()` declared in
 * schema.ts so drizzle-kit's snapshot tracks the FK; the hand-written
 * migration SQL wraps the actual ALTER TABLE in DO-block idempotency guards
 * (per MD-02 / 0002.sql lines 71-77).
 */
export const ritualResponses = pgTable(
  'ritual_responses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    promptText: text('prompt_text').notNull(),
    pensieveEntryId: uuid('pensieve_entry_id').references(() => pensieveEntries.id),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ritual_responses_ritual_id_fired_at_idx').on(
      table.ritualId,
      table.firedAt.desc(),
    ),
  ],
);

/**
 * RIT-03: ritual_fire_events — append-only log of every fire attempt
 * (success/skip/fail). Outcome string is one of 'fired'|'skipped'|'failed'
 * (or future values); kept as text for forward-compat without enum churn.
 */
export const ritualFireEvents = pgTable('ritual_fire_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
  firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
  outcome: text('outcome').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * RIT-03: ritual_config_events — append-only log of config patches
 * (cadence changes, fire_at changes, enable/disable). `actor` is the source
 * (e.g. 'user'|'admin'|'system'). `patch` is the JSON patch applied.
 */
export const ritualConfigEvents = pgTable('ritual_config_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
  actor: varchar('actor', { length: 32 }).notNull(),
  patch: jsonb('patch').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * RIT-03: ritual_pending_responses — open-prompt registry. A row exists
 * while a fired ritual prompt is awaiting user reply. `expires_at` enables
 * TTL sweep (Phase 27). `consumed_at` is set when a reply is bound to the
 * pending entry (mutual exclusion via UPDATE ... WHERE consumed_at IS NULL).
 */
export const ritualPendingResponses = pgTable(
  'ritual_pending_responses',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ritualId: uuid('ritual_id').notNull().references(() => rituals.id),
    chatId: bigint('chat_id', { mode: 'bigint' }).notNull(),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    promptText: text('prompt_text').notNull(), // ← Phase 26 amended D-26-02 (2026-04-27)
    metadata: jsonb('metadata').default(sql`'{}'::jsonb`), // ← Phase 28 migration 0010 (D-28-06 + RESEARCH Landmine 2)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Phase 26 PP#5 hot-path partial index: chat_id-keyed lookup for active
    // (non-consumed) pending responses. Mirrors Phase 25's
    // rituals_next_run_at_enabled_idx partial-index pattern.
    index('ritual_pending_responses_chat_id_active_idx')
      .on(table.chatId, table.expiresAt)
      .where(sql`${table.consumedAt} IS NULL`),
    // Phase 28 D-28-06 — partial index for 1-minute confirmation sweep.
    // Scoped to expired adjustment_confirmation rows. Sub-millisecond when zero pending.
    index('ritual_pending_responses_adjustment_confirmation_idx')
      .on(table.expiresAt)
      .where(sql`${table.consumedAt} IS NULL AND ${table.metadata}->>'kind' = 'adjustment_confirmation'`),
  ],
);

// ── M010 Phase 33: Operational profile tables (PROF-01/PROF-02) ──────────
// HARD CO-LOCATION #M10-1: these table defs + migration 0012 SQL +
// meta/0012_snapshot.json + _journal.json entry + scripts/test.sh psql
// apply line + scripts/regen-snapshots.sh cleanup-flag bump ALL ship in
// Plan 33-01 atomically. See .planning/STATE.md hard co-location constraints.
//
// Non-retrofittable columns (PITFALLS M010-09/10/11):
//   - schemaVersion / schema_version int NOT NULL DEFAULT 1
//   - substrateHash / substrate_hash text NOT NULL DEFAULT ''
//   - name text NOT NULL UNIQUE DEFAULT 'primary'
//   - dataConsistency / data_consistency real NOT NULL DEFAULT 0 with CHECK
//
// Field names locked against FEATURES.md §2.1-2.4 per Open Question 1.
// .$type<T>() compile-time inference: NEW pattern in this codebase
// (drizzle-orm 0.45.2 supports it; runtime validation via Zod in profiles.ts).

export const profileJurisdictional = pgTable(
  'profile_jurisdictional',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    dataConsistency: real('data_consistency').notNull().default(0),
    currentCountry: jsonb('current_country').$type<JurisdictionalProfileData['current_country']>().notNull().default(sql`'null'::jsonb`),
    physicalLocation: jsonb('physical_location').$type<JurisdictionalProfileData['physical_location']>().notNull().default(sql`'null'::jsonb`),
    residencyStatus: jsonb('residency_status').$type<JurisdictionalProfileData['residency_status']>().notNull().default(sql`'[]'::jsonb`),
    taxResidency: jsonb('tax_residency').$type<JurisdictionalProfileData['tax_residency']>().notNull().default(sql`'null'::jsonb`),
    activeLegalEntities: jsonb('active_legal_entities').$type<JurisdictionalProfileData['active_legal_entities']>().notNull().default(sql`'[]'::jsonb`),
    nextPlannedMove: jsonb('next_planned_move').$type<JurisdictionalProfileData['next_planned_move']>().notNull().default(sql`'{}'::jsonb`),
    plannedMoveDate: jsonb('planned_move_date').$type<JurisdictionalProfileData['planned_move_date']>().notNull().default(sql`'null'::jsonb`),
    passportCitizenships: jsonb('passport_citizenships').$type<JurisdictionalProfileData['passport_citizenships']>().notNull().default(sql`'[]'::jsonb`),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_jurisdictional_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('profile_jurisdictional_data_consistency_bounds', sql`${table.dataConsistency} >= 0 AND ${table.dataConsistency} <= 1`),
  ],
);

export const profileCapital = pgTable(
  'profile_capital',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    dataConsistency: real('data_consistency').notNull().default(0),
    fiPhase: jsonb('fi_phase').$type<CapitalProfileData['fi_phase']>().notNull().default(sql`'null'::jsonb`),
    fiTargetAmount: jsonb('fi_target_amount').$type<CapitalProfileData['fi_target_amount']>().notNull().default(sql`'null'::jsonb`),
    estimatedNetWorth: jsonb('estimated_net_worth').$type<CapitalProfileData['estimated_net_worth']>().notNull().default(sql`'null'::jsonb`),
    runwayMonths: jsonb('runway_months').$type<CapitalProfileData['runway_months']>().notNull().default(sql`'null'::jsonb`),
    nextSequencingDecision: jsonb('next_sequencing_decision').$type<CapitalProfileData['next_sequencing_decision']>().notNull().default(sql`'null'::jsonb`),
    incomeSources: jsonb('income_sources').$type<CapitalProfileData['income_sources']>().notNull().default(sql`'[]'::jsonb`),
    majorAllocationDecisions: jsonb('major_allocation_decisions').$type<CapitalProfileData['major_allocation_decisions']>().notNull().default(sql`'[]'::jsonb`),
    taxOptimizationStatus: jsonb('tax_optimization_status').$type<CapitalProfileData['tax_optimization_status']>().notNull().default(sql`'null'::jsonb`),
    activeLegalEntities: jsonb('active_legal_entities').$type<CapitalProfileData['active_legal_entities']>().notNull().default(sql`'[]'::jsonb`),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_capital_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('profile_capital_data_consistency_bounds', sql`${table.dataConsistency} >= 0 AND ${table.dataConsistency} <= 1`),
  ],
);

export const profileHealth = pgTable(
  'profile_health',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    dataConsistency: real('data_consistency').notNull().default(0),
    openHypotheses: jsonb('open_hypotheses').$type<HealthProfileData['open_hypotheses']>().notNull().default(sql`'[]'::jsonb`),
    pendingTests: jsonb('pending_tests').$type<HealthProfileData['pending_tests']>().notNull().default(sql`'[]'::jsonb`),
    activeTreatments: jsonb('active_treatments').$type<HealthProfileData['active_treatments']>().notNull().default(sql`'[]'::jsonb`),
    recentResolved: jsonb('recent_resolved').$type<HealthProfileData['recent_resolved']>().notNull().default(sql`'[]'::jsonb`),
    caseFileNarrative: jsonb('case_file_narrative').$type<HealthProfileData['case_file_narrative']>().notNull().default(sql`'null'::jsonb`),
    wellbeingTrend: jsonb('wellbeing_trend').$type<HealthProfileData['wellbeing_trend']>().notNull().default(sql`'{}'::jsonb`),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_health_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('profile_health_data_consistency_bounds', sql`${table.dataConsistency} >= 0 AND ${table.dataConsistency} <= 1`),
  ],
);

export const profileFamily = pgTable(
  'profile_family',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    name: text('name').notNull().default('primary').unique(),
    schemaVersion: integer('schema_version').notNull().default(1),
    substrateHash: text('substrate_hash').notNull().default(''),
    confidence: real('confidence').notNull().default(0),
    dataConsistency: real('data_consistency').notNull().default(0),
    relationshipStatus: jsonb('relationship_status').$type<FamilyProfileData['relationship_status']>().notNull().default(sql`'null'::jsonb`),
    partnershipCriteriaEvolution: jsonb('partnership_criteria_evolution').$type<FamilyProfileData['partnership_criteria_evolution']>().notNull().default(sql`'[]'::jsonb`),
    childrenPlans: jsonb('children_plans').$type<FamilyProfileData['children_plans']>().notNull().default(sql`'null'::jsonb`),
    parentCareResponsibilities: jsonb('parent_care_responsibilities').$type<FamilyProfileData['parent_care_responsibilities']>().notNull().default(sql`'{}'::jsonb`),
    activeDatingContext: jsonb('active_dating_context').$type<FamilyProfileData['active_dating_context']>().notNull().default(sql`'null'::jsonb`),
    milestones: jsonb('milestones').$type<FamilyProfileData['milestones']>().notNull().default(sql`'[]'::jsonb`),
    constraints: jsonb('constraints').$type<FamilyProfileData['constraints']>().notNull().default(sql`'[]'::jsonb`),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('profile_family_confidence_bounds', sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    check('profile_family_data_consistency_bounds', sql`${table.dataConsistency} >= 0 AND ${table.dataConsistency} <= 1`),
  ],
);

/**
 * profile_history — shared discriminator table (D-17).
 * Internal idempotency primitive: Phase 34's generator writes a snapshot
 * row before each upsert. Phase 33 is write-only (no reader). No FK on
 * profile_id (polymorphic across 4 profile tables — Postgres doesn't
 * support polymorphic FK; app-level discipline only).
 * Index ships now per OQ-3 (marginal cost on zero rows; simplifies Phase 34).
 */
export const profileHistory = pgTable(
  'profile_history',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`).notNull(),
    profileTableName: text('profile_table_name').notNull(),
    profileId: uuid('profile_id').notNull(),
    snapshot: jsonb('snapshot').$type<ProfileSnapshot>().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('profile_history_table_recorded_idx').on(table.profileTableName, table.recordedAt.desc()),
  ],
);
