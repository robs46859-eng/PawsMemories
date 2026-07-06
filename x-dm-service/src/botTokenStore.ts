/**
 * Bot token store — loads/persists X_BOT_ACCESS_TOKEN + X_BOT_REFRESH_TOKEN
 * in the x_oauth_tokens table. Seeded from env on first boot.
 * Provides refresh flow per §4.1 step 3.
 *
 * All xClient user-context calls use this store for the current token.
 *
 * Spec: X_DM_REFINEMENT_SPEC.md §4.1
 */

import { getConfig } from './config.js';
import { refreshBotToken } from './xClient.js';
import { getPool } from './db.js';

// ---------------------------------------------------------------------------
// Token accessors
// ---------------------------------------------------------------------------

/**
 * Load the current bot user access token.
 *
 * Priority: DB x_oauth_tokens table > env X_BOT_ACCESS_TOKEN fallback.
 * On first boot, seeds the DB from env vars.
 */
export async function getBotUserToken(): Promise<string> {
  const stored = await loadFromDb();
  if (stored) return stored.access_token;

  // Fallback to env var
  const cfg = getConfig();
  if (cfg.X_BOT_ACCESS_TOKEN) {
    await seedFromEnv();
    return cfg.X_BOT_ACCESS_TOKEN;
  }

  throw new Error('No bot user token available — complete OAuth flow at /oauth/start');
}

/**
 * Get the current refresh token.
 */
async function getRefreshToken(): Promise<string> {
  const stored = await loadFromDb();
  if (stored?.refresh_token) return stored.refresh_token;

  const cfg = getConfig();
  if (cfg.X_BOT_REFRESH_TOKEN) return cfg.X_BOT_REFRESH_TOKEN;

  throw new Error('No refresh token available');
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

interface TokenRow {
  access_token: string;
  refresh_token: string;
}

async function loadFromDb(): Promise<TokenRow | null> {
  try {
    const pool = getPool();
    const [rows] = await pool.execute(
      'SELECT access_token, refresh_token FROM x_oauth_tokens WHERE id = 1 LIMIT 1',
    );
    const data = rows as TokenRow[];
    return data.length > 0 ? data[0] : null;
  } catch {
    return null; // table might not exist yet
  }
}

/**
 * Persist tokens to the x_oauth_tokens table (upsert).
 */
export async function persistTokens(
  accessToken: string,
  refreshToken: string,
  userId?: string,
): Promise<void> {
  const pool = getPool();
  await pool.execute(
    `INSERT INTO x_oauth_tokens (id, user_id, access_token, refresh_token)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE access_token = VALUES(access_token), refresh_token = VALUES(refresh_token)`,
    [userId ?? getConfig().X_BOT_USER_ID, accessToken, refreshToken],
  );
  console.log('[BotTokenStore] Tokens persisted to DB');
}

/**
 * Seed tokens from env into DB on first boot.
 */
async function seedFromEnv(): Promise<void> {
  const cfg = getConfig();
  if (!cfg.X_BOT_ACCESS_TOKEN) return;
  await persistTokens(cfg.X_BOT_ACCESS_TOKEN, cfg.X_BOT_REFRESH_TOKEN, cfg.X_BOT_USER_ID);
}

// ---------------------------------------------------------------------------
// Token refresh (§4.1 step 3)
// ---------------------------------------------------------------------------

/**
 * Refresh the bot's OAuth 2.0 token. Called on 401 from dmSender/xClient.
 * Persists the new token pair to DB.
 *
 * Returns the new access token.
 */
export async function refreshAndPersist(): Promise<string> {
  const cfg = getConfig();
  const currentRefresh = await getRefreshToken();

  const resp = await refreshBotToken(
    cfg.X_CLIENT_ID,
    cfg.X_CLIENT_SECRET,
    currentRefresh,
  );

  const newAccess = resp.access_token;
  const newRefresh = resp.refresh_token ?? currentRefresh;

  await persistTokens(newAccess, newRefresh, cfg.X_BOT_USER_ID);
  console.log('[BotTokenStore] Token refreshed and persisted');

  return newAccess;
}