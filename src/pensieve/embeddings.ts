import { pipeline as createPipeline } from '@huggingface/transformers';
import { db } from '../db/connection.js';
import { pensieveEmbeddings } from '../db/schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

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
    return vectors[0];
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
