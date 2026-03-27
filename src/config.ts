import 'dotenv/config';

const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
};

export const config = {
  anthropicApiKey: required('ANTHROPIC_API_KEY'),
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  telegramAuthorizedUserId: parseInt(required('TELEGRAM_AUTHORIZED_USER_ID'), 10),
  databaseUrl: process.env.DATABASE_URL || 'postgresql://chris:chris@postgres:5432/chris',
  embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '384', 10),
  maxContextTokens: parseInt(process.env.MAX_CONTEXT_TOKENS || '80000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
} as const;
