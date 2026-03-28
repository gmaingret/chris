import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { fetchRecentPhotos, fetchAssetThumbnail, type ImmichAsset } from '../../immich/client.js';
import { assetToText } from '../../immich/metadata.js';
import { buildMessageHistory } from '../../memory/context-builder.js';
import { buildSystemPrompt } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Maximum number of photos to fetch and send to Claude vision per request.
 * Each preview thumbnail is ~100-200KB → ~150K base64 chars → ~1500 tokens.
 * 5 photos ≈ 7500 image tokens + prompt.
 */
const MAX_PHOTOS = 5;

/**
 * Parse a date range from the user's message for photo queries.
 * Returns takenAfter/takenBefore ISO strings, or undefined for "recent".
 *
 * Handles: "today", "yesterday", "this week", "last week",
 * "aujourd'hui", "hier", "cette semaine", "la semaine dernière"
 */
export function parseDateHint(text: string): {
  takenAfter?: string;
  takenBefore?: string;
} {
  const lower = text.toLowerCase();
  const now = new Date();

  // Today / aujourd'hui
  if (/\btoday\b|\baujourd'?hui\b|\bсегодня\b/i.test(lower)) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { takenAfter: start.toISOString() };
  }

  // Yesterday / hier
  if (/\byesterday\b|\bhier\b|\bвчера\b/i.test(lower)) {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { takenAfter: start.toISOString(), takenBefore: end.toISOString() };
  }

  // This week / cette semaine
  if (/\bthis week\b|\bcette semaine\b|\bна этой неделе\b/i.test(lower)) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return { takenAfter: start.toISOString() };
  }

  // Last week / la semaine dernière
  if (/\blast week\b|\bla semaine derni[eè]re\b|\bна прошлой неделе\b/i.test(lower)) {
    const end = new Date(now);
    end.setDate(end.getDate() - end.getDay());
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return { takenAfter: start.toISOString(), takenBefore: end.toISOString() };
  }

  // Default: recent (no filter, Immich returns newest first)
  return {};
}

/**
 * Handle a photo viewing request: fetch recent photos from Immich,
 * send thumbnails to Claude vision, and respond naturally.
 */
export async function handlePhotos(
  chatId: bigint,
  text: string,
): Promise<string> {
  const start = Date.now();

  try {
    // Parse date hints from the user's message
    const dateHint = parseDateHint(text);

    // Fetch matching photos from Immich
    const assets = await fetchRecentPhotos({
      ...dateHint,
      limit: MAX_PHOTOS,
    });

    if (assets.length === 0) {
      const latencyMs = Date.now() - start;
      logger.info({ chatId: chatId.toString(), latencyMs, photoCount: 0 }, 'chris.photos.empty');
      return ''; // empty string signals no photos found — engine will handle
    }

    // Fetch thumbnails in parallel (with individual error handling)
    const thumbnailPromises = assets.map(async (asset) => {
      try {
        const thumb = await fetchAssetThumbnail(asset.id);
        return { asset, thumb };
      } catch (err) {
        logger.warn(
          { assetId: asset.id, error: err instanceof Error ? err.message : String(err) },
          'chris.photos.thumbnail.error',
        );
        return null;
      }
    });

    const results = (await Promise.all(thumbnailPromises)).filter(
      (r): r is { asset: ImmichAsset; thumb: { base64: string; mediaType: 'image/jpeg' } } => r !== null,
    );

    if (results.length === 0) {
      logger.warn({ chatId: chatId.toString() }, 'chris.photos.all_thumbnails_failed');
      return '';
    }

    // Build the message content with images + metadata context
    const imageContent: Anthropic.Messages.ContentBlockParam[] = [];

    for (const { asset, thumb } of results) {
      // Add the image
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: thumb.mediaType,
          data: thumb.base64,
        },
      });

      // Add metadata context for this photo
      const meta = assetToText(asset);
      imageContent.push({
        type: 'text',
        text: `[Photo metadata: ${meta}]`,
      });
    }

    // Add the user's original message
    imageContent.push({
      type: 'text',
      text: text,
    });

    // Build conversation history (text-only context)
    const history = await buildMessageHistory(chatId);

    // Call Sonnet with vision
    const systemPrompt = buildSystemPrompt('JOURNAL');
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        ...history,
        { role: 'user', content: imageContent },
      ],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      throw new LLMError('No text block in Sonnet vision response');
    }

    const responseText = (textBlock as { type: 'text'; text: string }).text;
    const latencyMs = Date.now() - start;

    logger.info(
      {
        chatId: chatId.toString(),
        photoCount: results.length,
        latencyMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      'chris.photos.response',
    );

    return responseText;
  } catch (error) {
    if (error instanceof LLMError) throw error;

    const latencyMs = Date.now() - start;
    logger.warn(
      {
        chatId: chatId.toString(),
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'chris.photos.error',
    );

    throw new LLMError('Failed to process photo viewing request', error);
  }
}
