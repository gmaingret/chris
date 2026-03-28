import { logger } from '../../utils/logger.js';
import { OAuthError } from '../../utils/errors.js';
import {
  loadTokens,
  generateAuthUrl,
  exchangeCode,
  getAuthenticatedClient,
  hasRequiredScopes,
  DRIVE_READONLY_SCOPE,
} from '../../gmail/oauth.js';
import { syncGmail } from '../../gmail/sync.js';
import { syncDrive } from '../../drive/sync.js';
import { syncImmich } from '../../immich/sync.js';
import { config } from '../../config.js';
import { db } from '../../db/connection.js';
import { syncStatus } from '../../db/schema.js';

// ── Sync Status Formatting ──────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  gmail: '📧 Gmail',
  immich: '📷 Photos',
  gdrive: '📄 Drive',
};

const STATUS_EMOJI: Record<string, string> = {
  complete: '✅',
  error: '⚠️',
  syncing: '🔄',
};

/**
 * Format a Date as a human-readable relative time string (e.g. "2h ago").
 */
export function formatRelativeTime(date: Date | null): string {
  if (!date) return 'never';
  const now = Date.now();
  const diffMs = now - date.getTime();
  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format sync_status rows into a readable Telegram message.
 */
export function formatSyncStatus(
  rows: Array<{
    source: string;
    lastSyncAt: Date | null;
    entryCount: number | null;
    errorCount: number | null;
    status: string | null;
    lastError: string | null;
  }>,
): string {
  if (rows.length === 0) {
    return '📊 Sync Status\n\n⏳ No syncs have run yet.';
  }

  const lines = rows.map((row) => {
    const label = SOURCE_LABELS[row.source] ?? `🔗 ${row.source}`;
    const emoji = STATUS_EMOJI[row.status ?? ''] ?? '⏳';
    const entries = (row.entryCount ?? 0).toLocaleString();
    const errors = row.errorCount ?? 0;
    const relTime = formatRelativeTime(row.lastSyncAt);

    if (row.status === 'error') {
      const errMsg = row.lastError
        ? `"${row.lastError.slice(0, 80)}"`
        : 'unknown error';
      const lastSuccess = row.lastSyncAt
        ? `last success: ${relTime}`
        : 'no successful sync';
      return `${label}: ${emoji} error — ${errMsg} (${lastSuccess})`;
    }

    return `${label}: ${emoji} last synced ${relTime} — ${entries} entries, ${errors} errors`;
  });

  return `📊 Sync Status\n\n${lines.join('\n')}`;
}

/**
 * In-memory map tracking chat IDs that are awaiting an OAuth code.
 * When a user sends `/sync gmail` and has no tokens, we set their chatId
 * here, and the next text message from that chat is treated as an auth code.
 */
const pendingOAuthCodes = new Map<number, true>();

/**
 * Check whether a chatId is awaiting an OAuth code.
 */
export function isAwaitingOAuthCode(chatId: number): boolean {
  return pendingOAuthCodes.has(chatId);
}

/**
 * Handle an incoming text message that is potentially an OAuth code.
 * Called from the main message handler when isAwaitingOAuthCode is true.
 */
export async function handleOAuthCode(ctx: {
  chat: { id: number };
  message: { text: string };
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  const chatId = ctx.chat.id;
  const code = ctx.message.text.trim();

  pendingOAuthCodes.delete(chatId);

  try {
    await exchangeCode(code);
    await ctx.reply('✅ Authenticated! Starting Gmail sync...');

    // Fire-and-forget sync
    const client = await getAuthenticatedClient();
    syncGmail(client, (text) => ctx.reply(text)).catch((error) => {
      logger.error(
        { chatId, error: error instanceof Error ? error.message : String(error) },
        'gmail.sync.error',
      );
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ chatId, error: errMsg }, 'gmail.sync.oauth.code.error');
    await ctx.reply(
      '❌ That code didn\'t work. Please run /sync gmail again to get a fresh link.',
    );
  }
}

/**
 * Handle the `/sync` command.
 *
 * Usage: `/sync gmail`
 *
 * If no Google OAuth tokens exist, sends an auth URL for Greg to authorize.
 * If tokens exist, triggers an async Gmail sync with progress reporting.
 */
export async function handleSyncCommand(ctx: {
  chat: { id: number };
  from: { id: number };
  message: { text: string };
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  const text = ctx.message.text.trim();
  const parts = text.split(/\s+/);
  const subcommand = parts[1]?.toLowerCase();

  if (!subcommand) {
    await ctx.reply('Usage: /sync gmail | photos | drive | status\n\nSupported sources: gmail, photos, drive, status');
    return;
  }

  const chatId = ctx.chat.id;

  if (subcommand === 'status') {
    try {
      const rows = await db.select().from(syncStatus).orderBy(syncStatus.source);
      const message = formatSyncStatus(rows);
      await ctx.reply(message);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ chatId, error: errMsg }, 'sync.status.error');
      await ctx.reply('❌ Failed to fetch sync status.');
    }
    return;
  }

  if (subcommand === 'photos') {
    if (!config.immichApiUrl || !config.immichApiKey) {
      await ctx.reply('❌ Immich is not configured. Please set IMMICH_API_URL and IMMICH_API_KEY.');
      return;
    }
    await ctx.reply('📷 Starting photo sync...');
    syncImmich((msg) => ctx.reply(msg)).catch((error) => {
      logger.error(
        { chatId, error: error instanceof Error ? error.message : String(error) },
        'immich.sync.error',
      );
    });
    return;
  }

  if (subcommand === 'drive') {
    try {
      const tokens = await loadTokens('google');

      if (!tokens) {
        // No tokens — start OAuth flow
        const authUrl = generateAuthUrl();
        pendingOAuthCodes.set(chatId, true);
        await ctx.reply(
          `🔑 I need access to your Google Drive. Open this link and authorize:\n\n${authUrl}\n\nThen send me the code from the redirect URL.`,
        );
        return;
      }

      // Tokens exist but missing drive scope — prompt re-auth
      if (!hasRequiredScopes(tokens.scope, [DRIVE_READONLY_SCOPE])) {
        const authUrl = generateAuthUrl();
        pendingOAuthCodes.set(chatId, true);
        await ctx.reply(
          `🔑 I need expanded permissions to access your Drive. Please re-authorize:\n\n${authUrl}\n\nThen send me the code from the redirect URL.`,
        );
        return;
      }

      // Tokens have correct scope — trigger sync
      await ctx.reply('📄 Starting Drive sync...');

      const client = await getAuthenticatedClient();

      // Fire-and-forget — progress reported via sendMessage callback
      syncDrive(client, (msg) => ctx.reply(msg)).catch((error) => {
        logger.error(
          { chatId, error: error instanceof Error ? error.message : String(error) },
          'drive.sync.error',
        );
      });
    } catch (error) {
      if (error instanceof OAuthError) {
        pendingOAuthCodes.delete(chatId);
        try {
          const authUrl = generateAuthUrl();
          pendingOAuthCodes.set(chatId, true);
          await ctx.reply(
            `🔑 Your Google authorization expired. Please re-authorize:\n\n${authUrl}\n\nThen send me the code from the redirect URL.`,
          );
        } catch {
          await ctx.reply(
            '❌ Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
          );
        }
        return;
      }

      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error({ chatId, error: errMsg }, 'drive.sync.command.error');
      await ctx.reply(`❌ Sync failed: ${errMsg.slice(0, 200)}`);
    }
    return;
  }

  if (subcommand !== 'gmail') {
    await ctx.reply(
      `Unknown sync source: "${subcommand}". Currently supported: gmail, photos, drive, status`,
    );
    return;
  }

  try {
    // Check for existing tokens
    const tokens = await loadTokens('google');

    if (!tokens) {
      // No tokens — start OAuth flow
      const authUrl = generateAuthUrl();
      pendingOAuthCodes.set(chatId, true);
      await ctx.reply(
        `🔑 I need access to your Gmail. Open this link and authorize:\n\n${authUrl}\n\nThen send me the code from the redirect URL.`,
      );
      return;
    }

    // Tokens exist — trigger sync
    await ctx.reply('📧 Starting Gmail sync...');

    const client = await getAuthenticatedClient();

    // Fire-and-forget — progress reported via sendMessage callback
    syncGmail(client, (msg) => ctx.reply(msg)).catch((error) => {
      logger.error(
        { chatId, error: error instanceof Error ? error.message : String(error) },
        'gmail.sync.error',
      );
    });
  } catch (error) {
    if (error instanceof OAuthError) {
      // Token refresh failed or credentials missing — re-auth needed
      pendingOAuthCodes.delete(chatId);
      try {
        const authUrl = generateAuthUrl();
        pendingOAuthCodes.set(chatId, true);
        await ctx.reply(
          `🔑 Your Google authorization expired. Please re-authorize:\n\n${authUrl}\n\nThen send me the code from the redirect URL.`,
        );
      } catch {
        await ctx.reply(
          '❌ Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        );
      }
      return;
    }

    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error({ chatId, error: errMsg }, 'gmail.sync.command.error');
    await ctx.reply(`❌ Sync failed: ${errMsg.slice(0, 200)}`);
  }
}
