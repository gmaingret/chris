import { Composer } from 'grammy';
import type { Context } from 'grammy';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';

export const auth = new Composer<Context>();

auth.use(async (ctx, next) => {
  if (ctx.from?.id === config.telegramAuthorizedUserId) {
    await next();
  } else {
    logger.debug({ userId: ctx.from?.id }, 'Rejected unauthorized user');
  }
});
