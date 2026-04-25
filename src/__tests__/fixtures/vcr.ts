/**
 * src/__tests__/fixtures/vcr.ts — Phase 24 Plan 02 (SYNTH-07, D-03).
 *
 * Content-addressable VCR cache wrapping the Anthropic SDK's
 * `messages.parse` and `messages.create`. The hash key is a SHA-256 digest
 * over a canonical-stringified form of the request (keys sorted at every
 * nesting level), so ANY change to the request — model, system prompt,
 * messages, output schema, temperature, max_tokens — auto-invalidates the
 * cached entry without manual bookkeeping.
 *
 * Used by:
 *   - scripts/synthesize-delta.ts (Plan 24-02) — per-day Haiku style-transfer
 *   - scripts/synthesize-episodic.ts (Plan 24-03) — runConsolidate Sonnet path
 *
 * Layout (D-03): flat directory at tests/fixtures/.vcr/<hash>.json, atomic
 * writes via tmp-file + rename. POSIX rename is atomic; the miss path can
 * assume the target file does not exist (hash miss ≡ file-not-found).
 *
 * NEVER used in production code paths — test/fixture surface only.
 *
 * Testing note — `VCR_DIR` is mutable so unit tests can redirect writes to a
 * per-run tmp directory via `setVcrDirForTest()`. The production default
 * `'tests/fixtures/.vcr'` is restored by test teardown. Do NOT call
 * `setVcrDirForTest` from non-test code.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { anthropic } from '../../llm/client.js';
import { logger } from '../../utils/logger.js';

/**
 * ORIGINAL SDK references captured at module-load time. Required because
 * `scripts/synthesize-episodic.ts` does the singleton property-swap
 * `anthropic.messages.parse = cachedMessagesParse` to wire VCR transparently
 * into the production `runConsolidate()` engine. Without these snapshots,
 * the on-miss real-API call inside `cachedMessagesParse` would resolve back
 * to itself (the swapped reference) → infinite recursion → 6M+ identical
 * `vcr.miss` events / sec without any actual SDK call landing. Discovered
 * via prod operator UAT 2026-04-25 — see RETROSPECTIVE §v2.3 post-close.
 *
 * INVARIANT: vcr.ts MUST be imported BEFORE any caller swaps the SDK
 * reference. synthesize-episodic.ts respects this (imports vcr at L512,
 * swaps at L514). Future callers must follow the same order.
 */
const ORIGINAL_PARSE = anthropic.messages.parse.bind(anthropic.messages);
const ORIGINAL_CREATE = anthropic.messages.create.bind(anthropic.messages);

/**
 * Cache directory. `let` (not `const`) so test suites can override via
 * `setVcrDirForTest(tmpDir)` without patching fs internals.
 */
export let VCR_DIR = 'tests/fixtures/.vcr';

/**
 * Test-only helper. Redirects the cache directory for the duration of a
 * test suite. Production code paths must NOT call this.
 */
export function setVcrDirForTest(path: string): void {
  VCR_DIR = path;
}

/**
 * Canonical JSON stringifier — sorts object keys at every nesting level so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` hash identically. Arrays preserve
 * order (semantic: arrays are ordered collections). Handles circular
 * references defensively by emitting a `[Circular]` sentinel.
 */
function canonicalStringify(value: unknown): string {
  const seen = new WeakSet();
  const replacer = (_k: string, v: unknown): unknown => {
    if (v && typeof v === 'object') {
      if (seen.has(v as object)) return '[Circular]';
      seen.add(v as object);
      if (!Array.isArray(v)) {
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v as object).sort()) {
          sorted[k] = (v as Record<string, unknown>)[k];
        }
        return sorted;
      }
    }
    return v;
  };
  return JSON.stringify(value, replacer);
}

/**
 * Content-addressable hash key for an Anthropic request payload.
 * Exported so the synthesizer can pre-compute cache paths if needed.
 */
export function hashRequest(request: unknown): string {
  return createHash('sha256').update(canonicalStringify(request)).digest('hex');
}

async function atomicWriteJSON(path: string, body: unknown): Promise<void> {
  await mkdir(VCR_DIR, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(body, null, 2), 'utf8');
  await rename(tmp, path);
}

/**
 * Read cached JSON or return null if the file does not exist. ANY other
 * error (corruption, permission, invalid JSON) propagates — a corrupted
 * cache file is an actionable bug, not a silent fallback to the network.
 */
async function readCachedOrNull(path: string): Promise<unknown | null> {
  let body: string;
  try {
    body = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  return JSON.parse(body);
}

/**
 * Cached wrapper around `anthropic.messages.parse`. Preserves the full
 * return shape (including `parsed_output`, `content`, usage, etc.) because
 * the cached response is serialized via `JSON.stringify` and re-parsed on
 * hit — the shape is whatever the SDK gave us on the original miss.
 */
export async function cachedMessagesParse(
  request: Parameters<typeof anthropic.messages.parse>[0],
): Promise<Awaited<ReturnType<typeof anthropic.messages.parse>>> {
  const hash = hashRequest(request);
  const cachePath = join(VCR_DIR, `${hash}.json`);
  const cached = await readCachedOrNull(cachePath);
  if (cached !== null) {
    logger.info({ hash: hash.slice(0, 8), kind: 'parse' }, 'vcr.hit');
    return cached as Awaited<ReturnType<typeof anthropic.messages.parse>>;
  }
  logger.info({ hash: hash.slice(0, 8), kind: 'parse' }, 'vcr.miss');
  // Use ORIGINAL_PARSE (snapshotted at module load) — NOT
  // `anthropic.messages.parse`, which may have been property-swapped to
  // `cachedMessagesParse` by callers like synthesize-episodic.ts. Calling
  // the swapped reference would recurse infinitely on every miss.
  const response = await ORIGINAL_PARSE(request);
  await atomicWriteJSON(cachePath, response);
  return response;
}

/**
 * Cached wrapper around `anthropic.messages.create`. Same contract as
 * `cachedMessagesParse` but for the non-Zod path.
 */
export async function cachedMessagesCreate(
  request: Parameters<typeof anthropic.messages.create>[0],
): Promise<Awaited<ReturnType<typeof anthropic.messages.create>>> {
  const hash = hashRequest(request);
  const cachePath = join(VCR_DIR, `${hash}.json`);
  const cached = await readCachedOrNull(cachePath);
  if (cached !== null) {
    logger.info({ hash: hash.slice(0, 8), kind: 'create' }, 'vcr.hit');
    return cached as Awaited<ReturnType<typeof anthropic.messages.create>>;
  }
  logger.info({ hash: hash.slice(0, 8), kind: 'create' }, 'vcr.miss');
  // Same ORIGINAL_CREATE rationale as ORIGINAL_PARSE above — guards against
  // recursive swap-loops introduced by sibling-composition patterns.
  const response = await ORIGINAL_CREATE(request);
  await atomicWriteJSON(cachePath, response);
  return response;
}
