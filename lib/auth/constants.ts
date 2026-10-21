/**
 * Shared, non-secret constants for the SEP-10 style wallet authentication
 * handshake. Safe to import from both client and server code.
 */
import { APP_NAME } from "@/lib/utils/constants";

/** Route that hands out a challenge transaction to sign. */
export const CHALLENGE_ENDPOINT = "/api/auth/challenge";

/** Route that verifies a signed challenge and mints a Supabase access token. */
export const VERIFY_ENDPOINT = "/api/auth/verify";

/** Route to revoke an access token on signout. */
export const SIGNOUT_ENDPOINT = "/api/auth/signout";

/**
 * How long a challenge stays signable, in seconds.
 *
 * This is also the replay window on any deployment running without a shared
 * nonce store (see `lib/auth/sharedStore`), so it is kept short — long enough
 * for a wallet extension prompt, not long enough to be worth capturing.
 */
export const CHALLENGE_TTL_SECONDS = 60;

/**
 * Default lifetime of an issued Supabase access token, in seconds.
 *
 * Kept short because a leaked token is valid until it expires: the denylist
 * closes the sign-out gap, but only for sessions the user actually signs out
 * of. Renewing a token requires signing a new challenge in the wallet (SEP-10
 * handshake), so the app surfaces a visible expiry prompt rather than prompting
 * unannounced.
 */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;

/**
 * Warning window before token expiry, in seconds. The UI prompts the user to
 * re-sign with "Session expiring, sign to continue" within this window so
 * authenticated API requests continue without interruption.
 */
export const SESSION_REFRESH_SKEW_SECONDS = 5 * 60;

/** Tolerated clock drift between the browser and the server, in seconds. */
export const CLOCK_SKEW_SECONDS = 30;

/** `manage_data` key carried by the challenge transaction (max 64 bytes). */
export const CHALLENGE_DATA_NAME = `${APP_NAME} auth`.slice(0, 64);

/** JWT claim that carries the proven Stellar address. */
export const WALLET_CLAIM = "wallet_address";

/**
 * How long to wait on a single auth request before aborting it, in ms.
 *
 * Without a deadline a hung connection leaves the handshake promise pending
 * forever, and since it is shared by every concurrent caller the whole app
 * sits on its loading state with no way back. Generous enough to survive a
 * slow mobile network, short enough that a dead connection surfaces as an
 * error the user can retry.
 */
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

/** Legacy localStorage key removed during migration to the HttpOnly cookie. */
export const LS_SESSION = "settlex:session";
