/**
 * Server-side token revocation.
 *
 * Access tokens are bearer tokens: PostgREST accepts any correctly signed one
 * until its `exp`. Clearing the browser's copy on sign-out therefore proved
 * nothing — a token captured beforehand kept working for the rest of its life.
 *
 * Each token now carries a `jti`, and revoking one writes that id to
 * `public.revoked_tokens`. Every RLS policy resolves identity through
 * `settlex_wallet()`, which returns NULL for a revoked jti, so a denied token
 * matches no row on any table.
 *
 * Writing the denylist needs the service role key — a token must never be able
 * to un-revoke itself. Server-side only.
 */

/** Raised when the denylist cannot be written, so callers can fail closed. */
export class RevocationUnavailable extends Error {}

/** RPC timeout — sign-out must not hang on a slow database. */
const RPC_TIMEOUT_MS = 2_000;

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/[/]+$/, ""), key };
}

/** True when revocation is wired up, i.e. sign-out actually invalidates. */
export function isRevocationConfigured(): boolean {
  return config() !== null;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const settings = config();
  if (!settings) throw new RevocationUnavailable("No service role key is configured.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(`${settings.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: settings.key,
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify(args),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new RevocationUnavailable(`${fn} failed with HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof RevocationUnavailable) throw err;
    throw new RevocationUnavailable(`${fn} could not be reached: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Denies a single token id until `expiresAt`, after which its own expiry takes
 * over and the row is purged.
 */
export async function revokeToken(params: {
  jti: string;
  walletAddress: string;
  expiresAt: number;
}): Promise<void> {
  try {
    await rpc<unknown>("settlex_revoke_token", {
      p_jti: params.jti,
      p_wallet_address: params.walletAddress,
      p_expires_at: new Date(params.expiresAt * 1000).toISOString(),
    });
  } catch (err) {
    if (err instanceof RevocationUnavailable) throw err;
    throw new RevocationUnavailable(String(err));
  }
}

/**
 * Denies every token issued to a wallet before `now` — the "sign out
 * everywhere" case, and the one to reach for if a device is lost.
 *
 * @param walletAddress The Stellar address to revoke
 * @param ttlSeconds Optional tombstone lifetime in seconds. When omitted,
 *                   the database defaults to 13 hours (outliving the 12h session cap).
 */
export async function revokeWallet(
  walletAddress: string,
  ttlSeconds?: number,
): Promise<number> {
  try {
    const params: { p_wallet_address: string; p_ttl_seconds?: number } = {
      p_wallet_address: walletAddress,
    };
    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      params.p_ttl_seconds = ttlSeconds;
    }
    return await rpc<number>("settlex_revoke_wallet", params);
  } catch (err) {
    if (err instanceof RevocationUnavailable) throw err;
    throw new RevocationUnavailable(String(err));
  }
}

