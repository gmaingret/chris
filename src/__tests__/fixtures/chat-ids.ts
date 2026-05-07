/**
 * Centralized test chat IDs — one registry across all test suites.
 *
 * Phase 18 IN-03: Per-file unique `TEST_CHAT_ID` values avoid cleanup
 * collisions between test suites that share a database (e.g., two files
 * both deleting from `decisions WHERE chat_id = X` would wipe each other's
 * seeded rows). The `9991X` numeric convention was informal — a new test
 * file picking an arbitrary ID could silently collide with an existing one.
 *
 * Rule: every test file that writes chat-scoped rows to the real Postgres
 * MUST import its chat ID from this file. Do NOT hardcode `BigInt(9991X)`
 * literals in new test files.
 *
 * When adding a new test file, allocate the next ID here and import it.
 * Never reuse an ID across files.
 */

/** Live Telegram integration test (src/chris/__tests__/live-integration.test.ts). */
export const CHAT_ID_CHRIS_LIVE = BigInt(99901);

/** Phase 18 TEST-10/11/12 synthetic fixture (src/decisions/__tests__/synthetic-fixture.test.ts). */
export const CHAT_ID_SYNTHETIC_FIXTURE = BigInt(99918);

/** Phase 18 TEST-13 live accountability (src/decisions/__tests__/live-accountability.test.ts). */
export const CHAT_ID_LIVE_ACCOUNTABILITY = BigInt(99919);

/** Phase 18 TEST-14 live vague-validator (src/decisions/__tests__/vague-validator-live.test.ts). */
export const CHAT_ID_VAGUE_VALIDATOR_LIVE = BigInt(99920);

/** Phase 30 TEST-23..30 M009 synthetic fixture (src/rituals/__tests__/synthetic-fixture.test.ts). */
export const CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921);
