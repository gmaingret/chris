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
  'PSYCHOLOGY',
  'PHOTOS',
]);

export const contradictionStatusEnum = pgEnum('contradiction_status', [
  'DETECTED',
  'RESOLVED',
  'ACCEPTED',
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
