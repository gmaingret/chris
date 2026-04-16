import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const HAIKU_MODEL = config.haikuModel;
export const SONNET_MODEL = config.sonnetModel;
export const OPUS_MODEL = config.opusModel;

export const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});
