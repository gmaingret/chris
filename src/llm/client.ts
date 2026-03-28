import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
export const SONNET_MODEL = 'claude-sonnet-4-20250514';
export const OPUS_MODEL = 'claude-opus-4-6';

export const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});
