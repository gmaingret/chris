import { google } from 'googleapis';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { oauthTokens } from '../db/schema.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { OAuthError } from '../utils/errors.js';

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_SCOPES = [GMAIL_READONLY_SCOPE, DRIVE_READONLY_SCOPE];

/** Create an OAuth2 client configured with Google credentials from config. */
export function createOAuth2Client() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new OAuthError(
      'Google OAuth credentials not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    );
  }
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri,
  );
}

/** Generate the Google OAuth authorization URL for Gmail read-only access. */
export function generateAuthUrl(): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: GOOGLE_SCOPES,
    prompt: 'consent',
  });
}

/** Exchange an authorization code for tokens and persist them to DB. */
export async function exchangeCode(code: string): Promise<void> {
  const client = createOAuth2Client();
  try {
    const { tokens } = await client.getToken(code);
    await storeTokens('google', {
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token ?? null,
      expiryDate: tokens.expiry_date ?? null,
      scope: tokens.scope ?? null,
    });
  } catch (error) {
    throw new OAuthError('Failed to exchange authorization code for tokens', error);
  }
}

interface TokenData {
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  scope: string | null;
}

/** Upsert OAuth tokens for a given provider into the DB. */
export async function storeTokens(provider: string, tokens: TokenData): Promise<void> {
  const existing = await db
    .select({ id: oauthTokens.id })
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, provider))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(oauthTokens)
      .set({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? undefined,
        expiryDate: tokens.expiryDate ?? undefined,
        scope: tokens.scope ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(oauthTokens.provider, provider));
  } else {
    await db.insert(oauthTokens).values({
      provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? undefined,
      expiryDate: tokens.expiryDate ?? undefined,
      scope: tokens.scope ?? undefined,
    });
  }

  logger.info({ provider }, 'gmail.oauth.store');
}

/** Load OAuth tokens for a provider from the DB. Returns null if not found. */
export async function loadTokens(
  provider: string,
): Promise<TokenData | null> {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, provider))
    .limit(1);

  const found = rows.length > 0;
  logger.info({ provider, found }, 'gmail.oauth.load');

  if (!found) return null;

  const row = rows[0];
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? null,
    expiryDate: row.expiryDate ?? null,
    scope: row.scope ?? null,
  };
}

/**
 * Load tokens from DB, configure an OAuth2 client with them,
 * and register a `tokens` event listener that writes refreshed tokens back.
 * Throws OAuthError if no tokens are stored for 'google'.
 */
export async function getAuthenticatedClient() {
  const tokens = await loadTokens('google');
  if (!tokens) {
    throw new OAuthError(
      'No Google OAuth tokens found. Run /sync gmail to authenticate first.',
    );
  }

  const client = createOAuth2Client();
  client.setCredentials({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expiry_date: tokens.expiryDate,
    scope: tokens.scope ?? undefined,
  });

  // Auto-persist refreshed tokens
  client.on('tokens', async (newTokens) => {
    logger.info(
      { tokenExpiry: newTokens.expiry_date },
      'gmail.oauth.refresh',
    );
    await storeTokens('google', {
      accessToken: newTokens.access_token ?? tokens.accessToken,
      refreshToken: newTokens.refresh_token ?? tokens.refreshToken,
      expiryDate: newTokens.expiry_date ?? tokens.expiryDate,
      scope: newTokens.scope ?? tokens.scope,
    });
  });

  return client;
}

/**
 * Check whether a stored token scope string includes all required scopes.
 * Returns false if tokenScope is null or any required scope is missing.
 */
export function hasRequiredScopes(tokenScope: string | null, requiredScopes: string[]): boolean {
  if (!tokenScope) return false;
  return requiredScopes.every((scope) => tokenScope.includes(scope));
}
