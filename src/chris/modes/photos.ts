import { anthropic, HAIKU_MODEL, SONNET_MODEL } from '../../llm/client.js';
import { fetchRecentPhotos, fetchAssetThumbnail, type ImmichAsset } from '../../immich/client.js';
import { assetToText } from '../../immich/metadata.js';
import { buildMessageHistory } from '../../memory/context-builder.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Maximum number of photos to fetch and send to Claude vision per request.
 * Each preview thumbnail is ~100-200KB → ~150K base64 chars → ~1500 tokens.
 * 5 photos ≈ 7500 image tokens + prompt.
 */
const MAX_PHOTOS = 5;

/** Search filters extracted from the user's natural language photo request. */
export interface PhotoSearchFilters {
  takenAfter?: string;
  takenBefore?: string;
  city?: string;
  state?: string;
  country?: string;
}

const PHOTO_QUERY_PARSE_PROMPT = `You extract photo search filters from a user's message. Today's date is ${new Date().toISOString().slice(0, 10)}.

Return ONLY a JSON object with these optional fields:
- "takenAfter": ISO date string (start of date range)
- "takenBefore": ISO date string (end of date range)
- "city": city name in English
- "state": state/region name
- "country": country name

Rules:
- "today" / "aujourd'hui" → takenAfter = today at 00:00
- "yesterday" / "hier" → takenAfter/takenBefore for yesterday
- "this week" / "cette semaine" → takenAfter = start of this week
- "last week" / "la semaine dernière" → last week range
- "this winter" / "cet hiver" → takenAfter: December 1, takenBefore: March 1
- "last summer" / "l'été dernier" → June-August of the relevant year
- Location names → put in "city" (e.g., "Vyborg" → city: "Vyborg")
- If no date hint, omit date fields (returns recent photos)
- If no location hint, omit location fields
- Respond with ONLY the JSON object, no markdown fences, no explanation`;

/**
 * Use Haiku to extract photo search filters from a natural language request.
 * Falls back to empty filters (recent photos) on any failure.
 */
export async function parsePhotoQuery(text: string): Promise<PhotoSearchFilters> {
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      system: PHOTO_QUERY_PARSE_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') return {};

    const raw = (textBlock as { type: 'text'; text: string }).text;
    // Strip markdown fences (K003)
    const cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/, '$1').trim();
    const parsed = JSON.parse(cleaned);

    const filters: PhotoSearchFilters = {};
    if (parsed.takenAfter) filters.takenAfter = parsed.takenAfter;
    if (parsed.takenBefore) filters.takenBefore = parsed.takenBefore;
    if (parsed.city) filters.city = parsed.city;
    if (parsed.state) filters.state = parsed.state;
    if (parsed.country) filters.country = parsed.country;

    logger.info({ filters }, 'chris.photos.query_parsed');
    return filters;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'chris.photos.query_parse_failed',
    );
    return {};
  }
}

/** Result from handlePhotos — includes text summary of what was seen for conversation history. */
export interface PhotoResult {
  /** Chris's natural language response about the photos. */
  response: string;
  /**
   * Text summary of the photos that were viewed (metadata only, no images).
   * Saved alongside the user message so subsequent turns know what Chris saw.
   */
  photoContext: string;
}

/**
 * Handle a photo viewing request: fetch recent photos from Immich,
 * send thumbnails to Claude vision, and respond naturally.
 */
export async function handlePhotos(
  chatId: bigint,
  text: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): Promise<PhotoResult | null> {
  const start = Date.now();

  try {
    // Use LLM to extract search filters from the user's message
    const filters = await parsePhotoQuery(text);

    // Fetch matching photos from Immich
    const assets = await fetchRecentPhotos({
      ...filters,
      limit: MAX_PHOTOS,
    });

    if (assets.length === 0) {
      const latencyMs = Date.now() - start;
      logger.info({ chatId: chatId.toString(), latencyMs, photoCount: 0 }, 'chris.photos.empty');
      return null; // null signals no photos found — engine will handle
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
      return null;
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
    const systemPrompt = buildSystemPrompt('JOURNAL', undefined, undefined, language, declinedTopics);
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
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

    // Build text-only summary of what was seen for conversation history persistence
    const photoSummaries = results.map(({ asset }) => assetToText(asset));
    const photoContext = `[Chris viewed ${results.length} photo(s):\n${photoSummaries.join('\n---\n')}]`;

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

    return { response: responseText, photoContext };
  } catch (error) {
    // Graceful degradation: if Immich is down, return a friendly message instead of crashing
    const errMsg = error instanceof Error ? error.message : String(error);
    const isImmichDown = /network|ECONNREFUSED|ENOTFOUND|timeout|Immich API/i.test(errMsg);

    if (isImmichDown) {
      const latencyMs = Date.now() - start;
      logger.warn(
        { chatId: chatId.toString(), error: errMsg, latencyMs },
        'chris.photos.immich_unavailable',
      );
      // Return null — engine will fall back to journal mode
      return null;
    }

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
