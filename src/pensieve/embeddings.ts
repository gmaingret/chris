import { env, pipeline as createPipeline } from '@huggingface/transformers';
import { db } from '../db/connection.js';
import { pensieveEmbeddings } from '../db/schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// transformers.js does NOT honor HF_HOME / TRANSFORMERS_CACHE env vars; its
// default FileCache lands under node_modules/@huggingface/transformers/.cache,
// which trips EACCES when node_modules is mounted read-only (CI sandboxes,
// the bundled-deps Docker image). When either env var is set we redirect the
// cache to a writable path; otherwise we fall through to the default so
// production containers keep their existing cache layout.
//
// The `&& env` guard is defense-in-depth against test mocks that forget to
// stub the `env` export. Current unit tests (chunked-embedding.test.ts,
// embeddings.test.ts) stub `env: {}` explicitly; the guard exists so a
// future mock cannot silently break module load.
function configureTransformersCacheDir(): void {
  const cacheOverride = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME;
  if (cacheOverride && env) {
    env.cacheDir = cacheOverride;
  }
}
configureTransformersCacheDir();

// ── Singleton pipeline ─────────────────────────────────────────────────────

let pipelineInstance: Promise<any> | null = null;

/**
 * Lazily initialise and return the feature-extraction pipeline.
 * The promise is cached so the model loads exactly once.
 */
export function getEmbeddingPipeline(): Promise<any> {
  if (!pipelineInstance) {
    pipelineInstance = createPipeline('feature-extraction', config.embeddingModel);
  }
  return pipelineInstance;
}

/** Reset the singleton — exposed for testing only. */
export function resetPipeline(): void {
  pipelineInstance = null;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Split text into overlapping chunks for embedding.
 *
 * Returns at least one chunk even for short text. Each chunk is at most
 * `maxChars` characters, with `overlapChars` characters of overlap between
 * consecutive chunks.
 */
export function chunkText(
  text: string,
  maxChars: number = 4000,
  overlapChars: number = 400,
): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += maxChars - overlapChars;
  }

  return chunks;
}

/**
 * Embed a text string using bge-m3 with CLS pooling and L2 normalisation.
 *
 * Returns a 1024-dimensional float array, or null on any error.
 */
export async function embedText(text: string): Promise<number[] | null> {
  const start = Date.now();
  try {
    const pipe = await getEmbeddingPipeline();
    const output = await pipe(text, { pooling: 'cls', normalize: true });
    const vectors: number[][] = output.tolist();
    const latencyMs = Date.now() - start;
    logger.info({ latencyMs, model: config.embeddingModel }, 'pensieve.embed.latency');
    return vectors[0] ?? null;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'pensieve.embed.error',
    );
    return null;
  }
}

/**
 * Embed content and store the vector alongside the entry.
 *
 * Fire-and-forget contract: never throws. Logs success at info level
 * (`pensieve.embed`) and failures at warn (`pensieve.embed.error`).
 */
export async function embedAndStore(entryId: string, content: string): Promise<void> {
  const start = Date.now();
  try {
    const embedding = await embedText(content);
    if (!embedding) {
      logger.warn({ entryId, error: 'embedText returned null' }, 'pensieve.embed.error');
      return;
    }

    await db.insert(pensieveEmbeddings).values({
      entryId,
      embedding,
      chunkIndex: 0,
      model: config.embeddingModel,
    });

    const latencyMs = Date.now() - start;
    logger.info({ entryId, model: config.embeddingModel, latencyMs }, 'pensieve.embed');
  } catch (error) {
    logger.warn(
      { entryId, error: error instanceof Error ? error.message : String(error) },
      'pensieve.embed.error',
    );
  }
}

/**
 * Embed content in chunks and store multiple embedding rows per entry.
 *
 * Fire-and-forget contract: never throws. Splits content into overlapping
 * chunks, embeds each, and inserts with sequential `chunkIndex` values.
 * Logs `pensieve.embed.chunked` on success, `pensieve.embed.error` on failure.
 */
export async function embedAndStoreChunked(
  entryId: string,
  content: string,
): Promise<void> {
  const start = Date.now();
  try {
    const chunks = chunkText(content);
    // Track successful inserts separately from attempted: per-chunk
    // `embedText` failures `continue` past the insert, so logging only
    // `chunkCount: chunks.length` falsely implies full success when some
    // chunks were skipped. Surface both numbers so a partial-failure case
    // is auditable from the structured log.
    let chunksWritten = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const embedding = await embedText(chunk);
      if (!embedding) {
        logger.warn(
          { entryId, chunkIndex: i, error: 'embedText returned null' },
          'pensieve.embed.error',
        );
        continue;
      }

      await db.insert(pensieveEmbeddings).values({
        entryId,
        embedding,
        chunkIndex: i,
        model: config.embeddingModel,
      });
      chunksWritten++;
    }

    const totalLatencyMs = Date.now() - start;
    const logPayload = {
      entryId,
      chunkCount: chunks.length,
      chunksWritten,
      totalLatencyMs,
    };
    // Promote to warn when not every chunk landed so log-level filters
    // surface partial-success without changing the event name.
    if (chunksWritten < chunks.length) {
      logger.warn(logPayload, 'pensieve.embed.chunked');
    } else {
      logger.info(logPayload, 'pensieve.embed.chunked');
    }
  } catch (error) {
    logger.warn(
      { entryId, error: error instanceof Error ? error.message : String(error) },
      'pensieve.embed.error',
    );
  }
}
