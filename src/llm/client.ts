import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const HAIKU_MODEL = process.env.HAIKU_MODEL || 'claude-haiku-4-5-20251001';
export const SONNET_MODEL = process.env.SONNET_MODEL || 'claude-sonnet-4-20250514';
export const OPUS_MODEL = process.env.OPUS_MODEL || 'claude-opus-4-6';

export const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});
