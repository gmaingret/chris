# Stack Research — v2.5 M010 Operational Profiles

**Domain:** Operational profile inference + storage + read APIs  
**Researched:** 2026-05-11  
**Confidence:** HIGH (all recommendations are either existing deps at the installed version, or verified Drizzle/grammY patterns from the current codebase)  
**Scope:** STACK additions / changes for M010 *only*. Core stack is already correct and validated by M009.

---

## Headline

**No new direct dependencies. No version bumps required.**

M010 adds four profile tables, a weekly cron update function, a read API module, and a `/profile` Telegram command. Every capability composes from already-installed packages. The one new code pattern — jsonb columns with TypeScript type inference via `.$type<T>()` — is a Drizzle feature already present in the installed version (0.45.2).

| Capability | Mechanism | Dep status |
|---|---|---|
| Four profile tables with jsonb fields | `drizzle-orm` 0.45.2 `jsonb().$type<T>()` + new migration `0007_profiles.sql` | already installed |
| Profile upsert (weekly idempotent write) | `.onConflictDoUpdate()` — precedent in `src/proactive/state.ts` and `src/rituals/wellbeing.ts` | already installed |
| Confidence threshold count query | `db.select({ count: sql<number>\`count(*)\` }).from(pensieveEntries).where(...)` | already installed |
| Per-profile Sonnet structured-output | `anthropic.messages.parse({ output_config: { format: zodOutputFormat(...) } })` — established in `src/episodic/consolidate.ts` and `src/rituals/weekly-review.ts` | already installed |
| v3/v4 Zod dual-schema per profile | `zod` ^3.24.0 + `zod/v4` sub-path import — established pattern in codebase | already installed |
| Four sequential Sonnet calls in the weekly cron | Sequential `await` loop — no concurrency lib needed (fire-in-sequence, never fire-in-parallel, see §1) | no dep |
| `getOperationalProfiles()` reader API | `src/memory/profiles.ts` — plain Drizzle `.select()` | already installed |
| `/profile` Telegram command | `bot.command('profile', handleProfileCommand)` — same pattern as `/summary`, `/decisions` | already installed |
| Profile formatting for Telegram | Plain-text multi-section string rendering with `ctx.reply()` — no `parse_mode` (see §5) | already installed |
| Synthetic fixture test (30+ day) | `loadPrimedFixture` + `vi.setSystemTime` — D041 primed-fixture pipeline already in place | already installed |

---

## Question-by-question answers

### 1. Anthropic SDK patterns — new for M010?

**Multiple structured outputs back-to-back (sequential, not concurrent).**

M010 fires one Sonnet call per profile: `jurisdictional`, `capital`, `health`, `family` — four calls in sequence, each with a distinct system prompt and a distinct Zod schema. This is the right design (one focused prompt per profile, never a mega-prompt). The pattern is identical to the existing `generateWeeklyObservation` → `runStage2HaikuJudge` sequential chain in `src/rituals/weekly-review.ts`, except here all four calls use Sonnet (not a Sonnet + Haiku mix).

**Why sequential, not `Promise.all`:**
- Profile updates run in a weekly background cron, not in the hot path of a user message. Latency across the four calls (est. 8–20 seconds total) is entirely acceptable.
- Sequential execution means a failure in profile 2 does not orphan a committed profile 3 write. Each profile write succeeds or rolls back cleanly before the next call.
- `Promise.all` on four Sonnet calls would hit Anthropic's concurrent-requests rate limit (200 RPM per key, but burst limits apply to simultaneous in-flight requests). No benefit justifies this risk.

**Pattern (mirrors `src/episodic/consolidate.ts`):**

```typescript
// In src/memory/profile-updater.ts
for (const profileType of ['jurisdictional', 'capital', 'health', 'family'] as const) {
  const prompt = buildProfilePrompt(profileType, summaries, pensieveEntries);
  const response = await anthropic.messages.parse({
    model: SONNET_MODEL,
    max_tokens: 1000,
    system: [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'Update the profile.' }],
    output_config: {
      format: zodOutputFormat(profileSchemaV4Map[profileType] as unknown as any),
    },
  });
  // ... v3 re-validation + upsert
}
```

**Streaming? No.** Profile generation is a cron job that Greg never watches in real time. There is no UX surface that benefits from streaming. The `anthropic.messages.parse()` non-streaming path is simpler, produces the same Zod-validated output, and is what every other structured-output call in the codebase already uses. Do not add streaming.

**Confidence scoring patterns.** There is no `confidence_scorer` module to build. Confidence is computed as a deterministic formula *before* calling Sonnet:

```typescript
function computeConfidence(entryCount: number, consistencyFactor: number): number {
  // Below threshold: always 0
  if (entryCount < MIN_ENTRIES_THRESHOLD) return 0;
  // Scale from 0.3 (at threshold) to 1.0 (at saturation, e.g. 50 entries)
  const volumeScore = Math.min(1.0, (entryCount - MIN_ENTRIES_THRESHOLD) / (50 - MIN_ENTRIES_THRESHOLD));
  return Math.round((0.3 + 0.7 * volumeScore * consistencyFactor) * 100) / 100;
}
```

`consistencyFactor` (0.0–1.0) is returned from the Sonnet structured output — the model is asked to self-report how consistent the Pensieve evidence is for that profile dimension. This is the only "new" LLM pattern: the per-profile Sonnet schema includes a `data_consistency` field (0.0–1.0) alongside the profile-specific fields. The host code multiplies `volumeScore * consistencyFactor` to get the stored `confidence` value. This is grounded in observable data volume (entry count, a SQL aggregate) rather than letting Sonnet hallucinate an overall confidence from thin air.

**No new Anthropic SDK features needed.** `messages.parse()` + `zodOutputFormat()` is exactly what M010 uses. The SDK is at `^0.90.0`; no bump needed.

---

### 2. Drizzle patterns — new for M010?

**jsonb-heavy tables with typed columns.**

The four profile tables each have multiple `jsonb` columns whose shape varies per profile. The new pattern is `jsonb().$type<T>()`, which instructs Drizzle to type the TypeScript inference as `T` rather than `unknown`. This is already supported in Drizzle ORM 0.45.2 (present in `node_modules/drizzle-orm/pg-core/columns/json.d.ts`). The codebase has used `jsonb()` without `.$type<>()` (e.g. `proactiveState.value`, `rituals.config`) because those columns hold heterogeneous data. Profile-specific jsonb columns hold *known shapes*, so `.$type<>()` unlocks compile-time safety.

**Example:**

```typescript
// In src/db/schema.ts
import type { JurisdictionalProfile } from '../memory/profile-types.js';

export const profileJurisdictional = pgTable('profile_jurisdictional', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull(),
  confidence: real('confidence').notNull().default(0),
  currentLocation: text('current_location'),
  residencyStatuses: jsonb('residency_statuses').$type<{ country: string; status: string; since?: string }[]>(),
  taxStructures: jsonb('tax_structures').$type<{ jurisdiction: string; regime: string }[]>(),
  nextPlannedMove: text('next_planned_move'),
  plannedMoveDate: text('planned_move_date'),
}, (table) => [
  index('profile_jurisdictional_last_updated_idx').on(table.lastUpdated),
  // No UNIQUE here — this is a singleton table (one row, always upserted on id='singleton')
]);
```

**Singleton upsert pattern.** Each profile table holds exactly one row (single-user system). The canonical pattern is a fixed `id` (a deterministic UUID constant, like `JURISDICTIONAL_PROFILE_ID = '00000000-0000-0000-0000-000000000001'`), upserted on every weekly run:

```typescript
await db.insert(profileJurisdictional)
  .values({ id: JURISDICTIONAL_PROFILE_ID, lastUpdated: new Date(), confidence, ...fields })
  .onConflictDoUpdate({
    target: profileJurisdictional.id,
    set: { lastUpdated: new Date(), confidence, ...fields },
  });
```

This mirrors `src/proactive/state.ts`'s `setValue()` KV upsert pattern, applied to a typed row.

**Partial index for the threshold check.** The threshold query (`count(*) of FACT/RELATIONSHIP/INTENTION/EXPERIENCE-tagged entries`) is a simple aggregate:

```typescript
const [row] = await db
  .select({ count: sql<number>`count(*)::int` })
  .from(pensieveEntries)
  .where(
    and(
      isNull(pensieveEntries.deletedAt),
      inArray(pensieveEntries.epistemicTag, ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE']),
    )
  );
const entryCount = row?.count ?? 0;
```

A partial index is not required for the threshold check — it is a single aggregate over a small table (Greg-scale, order of thousands of rows) that runs once per week. The existing `pensieve_entries_content_hash_idx` is the only index on that table, and the aggregate scan is negligible at this scale. **Do not add a partial index for the threshold check.** This is consistent with the codebase's existing pattern of only adding indexes on the sweep hot-path (D034 precedent).

**No composite confidence + freshness query needed.** Profile freshness is a derived property (`Date.now() - lastUpdated`), computed in the `getOperationalProfiles()` reader rather than in SQL. SQL aggregates for confidence + freshness together would be premature optimization at this scale.

**No new Drizzle version bump.** `drizzle-orm` ^0.45.2 and `drizzle-kit` ^0.31.10 already support `jsonb().$type<>()`, `onConflictDoUpdate`, `real()` (for 0.0–1.0 confidence), and `.where(sql\`...\`)` partial indexes. Migration 0007 ships in the same hand-written SQL pattern as 0006.

---

### 3. Zod patterns — new for M010?

**Four distinct v3 schemas + four v4 mirrors. Not one polymorphic schema.**

The four profile types have structurally distinct fields. A polymorphic/discriminated union schema would add complexity without benefit: the Sonnet prompt is already different per profile type, so the schema at each SDK boundary is different per call. Use four distinct schema pairs, mirroring the `WeeklyReviewSchema`/`WeeklyReviewSchemaV4` + `StageTwoJudgeSchema`/`StageTwoJudgeSchemaV4` precedent from `src/rituals/weekly-review.ts`.

**One new per-profile pattern:** each v3 schema includes a `data_consistency` field (0.0–1.0 float) that the Sonnet output must return alongside the profile fields. This is the consistency factor used in the confidence computation (see §1). The v4 mirror omits refinements (same rule as all other v4 mirrors in the codebase).

**Example for jurisdictional profile:**

```typescript
// v3 — contract surface + re-validation gate
export const JurisdictionalProfileSchema = z.object({
  current_location: z.string().min(1).max(200),
  residency_statuses: z.array(z.object({
    country: z.string(),
    status: z.string(),
    since: z.string().optional(),
  })).max(10),
  tax_structures: z.array(z.object({
    jurisdiction: z.string(),
    regime: z.string(),
  })).max(10),
  next_planned_move: z.string().max(200).nullable(),
  planned_move_date: z.string().max(50).nullable(),
  data_consistency: z.number().min(0).max(1),  // ← new per M010
});

// v4 — SDK boundary mirror only, no refine
export const JurisdictionalProfileSchemaV4 = zV4.object({
  current_location: zV4.string().min(1).max(200),
  residency_statuses: zV4.array(zV4.object({
    country: zV4.string(),
    status: zV4.string(),
    since: zV4.string().optional(),
  })).max(10),
  tax_structures: zV4.array(zV4.object({
    jurisdiction: zV4.string(),
    regime: zV4.string(),
  })).max(10),
  next_planned_move: zV4.string().max(200).nullable(),
  planned_move_date: zV4.string().max(50).nullable(),
  data_consistency: zV4.number().min(0).max(1),
});
```

**Keep all type definitions in `src/memory/profile-types.ts`** (a pure types file). Schema files stay in the source file that owns the SDK boundary (`src/memory/profile-updater.ts`). This mirrors how `src/episodic/types.ts` holds the Zod types while `src/episodic/consolidate.ts` holds the v4 mirror at the SDK call site.

**No polymorphic union.** A discriminated union (`z.discriminatedUnion('profileType', [...])`) would require Sonnet to embed a `profileType` discriminant in its response, complicating the prompt and the schema without any benefit. The call-site already knows which profile it is calling.

---

### 4. grammY patterns — new for M010?

**`/profile` command: no new grammY patterns. Extends the existing `/summary` + `/decisions` command pattern.**

Register in `src/bot/bot.ts` with:

```typescript
bot.command('profile', handleProfileCommand as any);
```

The `as any` cast is already used for every command handler in `bot.ts` (grammY's `Context` type is narrower than the handler signature inferred by TypeScript in ESM — established pattern).

**Formatting structured profile data for Telegram.**

The existing codebase uses **plain text only** (no `parse_mode`) for all command responses. The `src/bot/handlers/summary.ts` JSDoc explicitly states:

> *"Plain text (no parse_mode: 'Markdown') per D-31 — Markdown escape complexity for user-origin content in key_quotes is a footgun, and the visual gain is marginal."*

This reasoning applies even more strongly to profile data: profile fields contain user-origin content (location names, regime names, health hypothesis text) that would require careful escaping for MarkdownV2. The visual benefit (bold headers, monospace) is outweighed by the escape-correctness burden.

**Recommended formatting pattern** (mirrors `formatSummary` in `summary.ts`):

```typescript
function formatProfiles(profiles: OperationalProfiles, lang: Lang): string {
  const sections: string[] = [];

  sections.push('=== OPERATIONAL PROFILES ===');
  sections.push('');

  // Jurisdictional
  sections.push(`[Jurisdictional] confidence: ${(profiles.jurisdictional.confidence * 100).toFixed(0)}%`);
  if (profiles.jurisdictional.confidence === 0) {
    sections.push('  Insufficient data (need 10+ Pensieve entries)');
  } else {
    sections.push(`  Location: ${profiles.jurisdictional.currentLocation ?? 'unknown'}`);
    // ...etc
  }
  sections.push('');

  // Capital, Health, Family — same pattern

  sections.push('[Psychological] Not yet available — see M011');

  return sections.join('\n');
}
```

**Do NOT add `parse_mode: 'HTML'` or `parse_mode: 'MarkdownV2`** to the `/profile` response. The D-31 decision (plain text for command outputs) is codebase policy, not a suggestion. Adding HTML formatting to `/profile` would be inconsistent with every other command handler and would require escaping profile field content (which may contain angle brackets, ampersands, asterisks) that originates from Greg's own free-text entries.

**Message length.** Four profiles with sparse-to-moderate data will produce 300–600 characters. Well within Telegram's 4096-character text limit. No pagination needed.

---

### 5. Confidence-scoring helper module

**Build a small internal helper, not a library.**

`src/memory/confidence.ts` — a pure-function module, no exports to other subsystems:

```typescript
export const MIN_ENTRIES_THRESHOLD = 10;  // M010 spec

export function computeProfileConfidence(entryCount: number, consistencyFactor: number): number {
  if (entryCount < MIN_ENTRIES_THRESHOLD) return 0;
  const SATURATION = 50;  // entry count at which volumeScore = 1.0
  const volumeScore = Math.min(1.0, (entryCount - MIN_ENTRIES_THRESHOLD) / (SATURATION - MIN_ENTRIES_THRESHOLD));
  return Math.round((0.3 + 0.7 * volumeScore * consistencyFactor) * 100) / 100;
}

export function isAboveThreshold(entryCount: number): boolean {
  return entryCount >= MIN_ENTRIES_THRESHOLD;
}
```

This is a "build now" item because:
1. It is called from four places (once per profile in the updater loop) — a shared function prevents divergence.
2. It is the one domain-specific algorithm M010 introduces. Test it independently (pure function, no mocks needed).
3. The `SATURATION` constant will likely be tuned after real data accumulates — isolating it in one file makes tuning cheap.

**Why not a library?** Confidence scoring for a single-user personal journal profile is a bespoke heuristic, not a general-purpose problem. npm has no package that would help here. Building one ourselves costs 15 lines of code and zero dependencies.

---

## New module structure (code, not deps)

```
src/memory/
  profiles.ts           # getOperationalProfiles() reader API (new)
  profile-updater.ts    # updateAllProfiles() weekly cron function (new)
  profile-types.ts      # TypeScript types for all four profiles (new)
  confidence.ts         # computeProfileConfidence() + isAboveThreshold() (new)

src/bot/handlers/
  profile.ts            # handleProfileCommand() for /profile (new)

src/db/migrations/
  0007_profiles.sql     # four profile tables (new)
```

`src/db/schema.ts` additions:
- `profileJurisdictional`, `profileCapital`, `profileHealth`, `profileFamily` tables
- Each: `uuid pk`, `timestamptz last_updated`, `real confidence`, profile-specific `jsonb().$type<T>()` columns
- Each: `btree(last_updated)` index (profile freshness queries)
- **No UNIQUE constraint** — singleton pattern uses a fixed deterministic UUID constant per table, upserted on `id`

---

## Version-bump assessment (none required)

| Dep | Installed | Latest (2026-05-11) | Bump needed? |
|---|---|---|---|
| `@anthropic-ai/sdk` | ^0.90.0 | ~0.90+ | **No.** `messages.parse` + `zodOutputFormat` pattern is unchanged from M008/M009. |
| `grammy` | ^1.31.0 | 1.42+ | **No.** `bot.command()` + `ctx.reply()` are pre-1.0 stable surface. |
| `drizzle-orm` | ^0.45.2 | 0.45+ | **No.** `jsonb().$type<>()`, `onConflictDoUpdate`, `real()` all present. |
| `drizzle-kit` | ^0.31.10 | 0.31+ | **No.** Hand-written migration SQL pattern continues. |
| `zod` | ^3.24.0 | (v4 exists) | **No.** v3 + `zod/v4` sub-path dual-schema pattern continues exactly as established. |
| `luxon` | ^3.7.2 | 3.7.2 | Exact match. Weekly cron uses existing `DateTime` patterns. |
| `node-cron` | ^4.2.1 | 4.2.1 | Exact match. Profile update hooks into the existing sweep or a new weekly cron peer. |

---

## Anti-recommendations (DO NOT add)

| Package / Pattern | Why not |
|---|---|
| A new LLM provider (OpenAI, Gemini, Mistral) | The three-tier Anthropic strategy (Haiku/Sonnet/Opus) handles everything M010 needs. Sonnet 4.6 for per-profile generation; Haiku not needed (profile generation is not a cheap classify task). No rationale for a second provider. |
| A separate vector store (Pinecone, Weaviate, Qdrant) | Profile inference reads from `episodic_summaries` (SQL, date range) and `pensieve_entries` (SQL, epistemic tag filter). No semantic similarity search needed. `pgvector` remains the only vector store. |
| A confidence-scoring library (`ml-confidence`, `bayesian-network`, etc.) | Confidence is a deterministic formula over entry count + LLM-returned consistency factor. It has no statistical learning component that would justify a library. |
| Streaming (`anthropic.messages.stream()`) for profile generation | Profile updates run in a weekly background cron with no real-time UX surface. Streaming adds complexity with zero user benefit. |
| `Promise.all` for the four Sonnet profile calls | Sequential `await` in a loop is safer (failure isolation, no rate-limit burst) and fast enough (8–20s total for a cron job). |
| GraphQL / REST API surface | The bot itself is the read surface (`/profile` command). `getOperationalProfiles()` is an internal module called by mode handlers and the command. No HTTP API needed. |
| `@grammyjs/conversations` or any Grammy plugin | The `/profile` command is a read-only, no-conversation response. Zero state management needed. |
| `parse_mode: 'HTML'` or `parse_mode: 'MarkdownV2'` | D-31 policy (plain text for command outputs) is codebase law. Profile field content is user-origin and unsafe to format without escaping every string. |
| A separate cron job / queue for profile updates | Profile updates run weekly. Slot them inside the existing sweep (as a low-priority tail step, after reactive triggers) or as a simple node-cron peer — same architecture as `episodic/cron.ts`. No BullMQ, no Agenda, no job queue. |
| Bumping `@anthropic-ai/sdk`, `grammy`, `drizzle-orm`, or `zod` as part of M010 | Each is an orthogonal tech-debt item. Bundling version bumps with M010 capability work risks attribution confusion in the git history and increases test surface. |
| `tiktoken` or any tokenizer | Profile prompts are capped by Zod schema size limits. Token estimation is not needed. |
| A "profile inference engine" abstraction layer | The four sequential Sonnet calls in `profile-updater.ts` are self-contained. An abstraction layer (factory pattern, plugin registry, etc.) would add indirection without enabling any reuse that M011/M012 actually needs — those milestones have their own schema and prompt designs. |

---

## Integration with existing patterns

| Existing Pattern | How M010 Uses It |
|---|---|
| `zodOutputFormat` + v3/v4 dual-schema | Four schema pairs (one per profile) in `profile-updater.ts`. Same cast, same re-validation gate. |
| `onConflictDoUpdate` singleton upsert | One upsert per profile table per weekly run, keyed on a fixed deterministic UUID constant. |
| `getEpisodicSummariesRange()` | Called with `[weekStart, weekEnd]` — already the established API from `src/pensieve/retrieve.ts`. |
| `hybridSearch` / tag-filtered `pensieve_entries` query | Threshold count + context pull use `inArray(pensieveEntries.epistemicTag, ['FACT','RELATIONSHIP','INTENTION','EXPERIENCE'])` — same tag list as JOURNAL_SEARCH_OPTIONS but as a WHERE filter, not hybrid search. |
| CONSTITUTIONAL_PREAMBLE in system prompt | Per-profile Sonnet calls inject the same preamble as `src/episodic/consolidate.ts` — non-negotiable per M006. |
| pino `logger` | `profile.update.start`, `profile.update.success`, `profile.update.skipped.threshold`, `profile.update.failed` — four log events per profile, matching the `rituals.weekly.*` event naming convention. |
| `getLastUserLanguageFromDb` | Not used in the weekly cron (it's a background process, not a user-visible response). The `/profile` command handler uses `getLastUserLanguage(chatId.toString())` exactly as `/summary` does. |

---

## Sources

- `package.json` — installed deps + versions (verified 2026-05-11).
- `src/db/schema.ts` — existing column types, index patterns, `check()` constraint patterns.
- `src/episodic/consolidate.ts` — v3/v4 dual-schema + `messages.parse({ output_config })` authoritative pattern.
- `src/rituals/weekly-review.ts` — sequential multi-schema call pattern (Sonnet + Haiku), `zodOutputFormat` cast, retry loop.
- `src/proactive/state.ts` — `onConflictDoUpdate` singleton upsert pattern.
- `src/bot/handlers/summary.ts` — command handler structure, plain-text formatting, D-31 policy.
- `src/bot/bot.ts` — command registration pattern (`bot.command(..., handler as any)`).
- `src/pensieve/retrieve.ts` — `getEpisodicSummariesRange()` API, tag-filtered query patterns.
- `node_modules/drizzle-orm/pg-core/columns/json.d.ts` — `.$type<T>()` present in installed 0.45.2.
- Context7 `/drizzle-team/drizzle-orm-docs` — jsonb column definition, `onConflictDoUpdate`, partial index `.where(sql\`\`)` (all confirmed present in 0.45.2).
- Context7 `/websites/grammy_dev` — `sendMessage` formatting options, parse_mode (HTML/MarkdownV2 confirmed available but excluded per D-31).
- M010_Operational_Profiles.md — milestone spec.
- `.planning/PROJECT.md` — D029, D030, D034, D041 decisions.

---

*Stack research for M010: 2026-05-11. No deps added, no version bumps. Five new source files + one migration. All patterns compose from M008/M009 precedents.*
