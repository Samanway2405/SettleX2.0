/**
 * Wallet-authenticated Supabase sessions.
 *
 * A Supabase client is only trusted with a wallet identity after the wallet has
 * signed a server-issued challenge (`/api/auth/challenge` → `/api/auth/verify`)
 * and the server has minted a JWT carrying a `wallet_address` claim. RLS
 * policies read that claim, so an access token cannot be forged client-side the
 * way the old `x-wallet-address` request header could.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import {
  AUTH_REQUEST_TIMEOUT_MS,
  CHALLENGE_ENDPOINT,
  LS_SESSION,
  SESSION_REFRESH_SKEW_SECONDS,
  SIGNOUT_ENDPOINT,
  VERIFY_ENDPOINT,
  WALLET_CLAIM,
} from "@/lib/auth/constants";
import { signXDR } from "@/lib/freighter";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface WalletSession {
  walletAddress: string;
  accessToken: string;
  /** Expiry in milliseconds since the epoch. */
  expiresAt: number;
}

/** Raised when the handshake could not complete (rejected signature, etc.). */
export class WalletSessionError extends Error {}

// ─── Token claims ─────────────────────────────────────────────────────────────

/**
 * The parts of the token this client trusts. They come from the JWT payload
 * itself, never from the JSON fields stored beside it.
 */
interface TokenClaims {
  walletAddress: string;
  /** Expiry in milliseconds since the epoch. */
  expiresAt: number;
}

/**
 * Decodes a JWT payload without verifying the signature.
 *
 * The signature cannot be checked here — the secret is server-side, which is
 * the whole point. That is fine: this is not an authorization decision. The
 * server re-verifies the token on every request and RLS authorizes on the real
 * claim, so a forged token gets the browser nothing. What reading the claims
 * *does* buy is that the UI shows the identity the token actually carries,
 * instead of a sibling JSON field an attacker could set to any address.
 */
function decodeTokenClaims(accessToken: string): TokenClaims | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length !== 3) return null;

    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    const claims: unknown = JSON.parse(json);
    if (!claims || typeof claims !== "object") return null;

    const record = claims as Record<string, unknown>;
    const walletAddress = record[WALLET_CLAIM];
    const exp = record.exp;
    if (typeof walletAddress !== "string" || !walletAddress) return null;
    if (typeof exp !== "number") return null;

    return { walletAddress, expiresAt: exp * 1000 };
  } catch {
    return null;
  }
}

// ─── Cached session ───────────────────────────────────────────────────────────

/**
 * Freshness measured against the token's own `exp`, so editing the stored
 * `expiresAt` cannot make a dead token look alive.
 */
function isFresh(session: WalletSession, now = Date.now()): boolean {
  const claims = decodeTokenClaims(session.accessToken);
  if (!claims) return false;
  return claims.expiresAt - SESSION_REFRESH_SKEW_SECONDS * 1000 > now;
}

/**
 * Returns the stored session only if the token itself proves it belongs to
 * `walletAddress` and has not expired.
 *
 * The stored `walletAddress`/`expiresAt` fields are a cache hint and nothing
 * more: pairing a victim's address with an attacker's valid token used to make
 * the UI mark the victim's wallet as verified, because these checks read the
 * JSON beside the token rather than the claims inside it.
 */
export function readStoredSession(walletAddress: string): WalletSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const stored = JSON.parse(raw) as WalletSession;
    if (!stored?.accessToken || typeof stored.accessToken !== "string") return null;

    const claims = decodeTokenClaims(stored.accessToken);
    if (!claims) return null;
    if (claims.walletAddress !== walletAddress) return null;

    // Rebuild from the claims so nothing downstream can read a forged field.
    const session: WalletSession = {
      walletAddress: claims.walletAddress,
      accessToken: stored.accessToken,
      expiresAt: claims.expiresAt,
    };
    if (!isFresh(session)) return null;
    return session;
  } catch {
    return null;
  }
}

/**
 * Reads the stored session without checking which wallet it belongs to. Only
 * for sign-out, where the point is to revoke whatever token this browser holds.
 */
function readAnyStoredSession(): WalletSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_SESSION);
    if (!raw) return null;
    const session = JSON.parse(raw) as WalletSession;
    return session?.accessToken ? session : null;
  } catch {
    return null;
  }
}

function storeSession(session: WalletSession): void {
  try {
    window.localStorage.setItem(LS_SESSION, JSON.stringify(session));
  } catch {
    // Private-mode browsers refuse writes — the in-memory copy still works.
  }
}

/**
 * Tells the server to revoke the current token, so it stops working everywhere
 * rather than only in this browser.
 *
 * Fire-and-forget by design: the local session is cleared either way, because a
 * user who clicked "sign out" must never be left holding a live session just
 * because the network failed. The token stays denied server-side once the call
 * lands; if it never lands, the short TTL is the backstop.
 */
function revokeOnServer(session: WalletSession, everywhere: boolean): void {
  try {
    const body = JSON.stringify({ everywhere });
    void fetch(SIGNOUT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body,
      keepalive: true,
    }).catch(() => {
      // Already logged out locally; nothing useful to show the user here.
    });
  } catch {
    // ignore
  }
}

/**
 * Drops the cached token and revokes it server-side, so the next authenticated
 * call re-runs the handshake and the old token is dead rather than merely
 * forgotten.
 *
 * Pass `everywhere` to also deny every other token issued to this wallet.
 */
export function clearWalletSession(options: { everywhere?: boolean } = {}): void {
  // After a reload the in-memory copy is gone but localStorage still holds a
  // live token — read it back, or sign-out would revoke nothing in exactly the
  // case that matters most.
  const revoking = memoizedSession ?? readAnyStoredSession();
  if (revoking) revokeOnServer(revoking, options.everywhere === true);

  sessionEpoch += 1;
  memoizedSession = null;
  inFlight.clear();
  if (memoizedClient) {
    void memoizedClient.client.removeAllChannels();
    memoizedClient = null;
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LS_SESSION);
    } catch {
      // ignore
    }
  }
  notifySessionChange();
}

let memoizedSession: WalletSession | null = null;

/**
 * In-flight handshakes, keyed by the wallet they are signing for.
 *
 * This was a single slot, which meant a call for wallet B arriving while A's
 * handshake was pending got handed A's promise -- and therefore A's token.
 * Nothing downstream re-checked the address, so the UI marked B verified while
 * every request went out signed as A. Keying by address is what lets two
 * wallets have distinct handshakes in flight; the per-address entry still
 * dedupes concurrent callers, so a wallet is asked to sign only once.
 */
const inFlight = new Map<string, Promise<WalletSession>>();

/**
 * Bumped by `clearWalletSession`. A handshake that started before the bump has
 * been disowned: signing out mid-handshake must not leave the browser holding
 * the session that lands a moment later.
 */
let sessionEpoch = 0;

// ─── Change notifications ─────────────────────────────────────────────────────

const listeners = new Set<() => void>();

function notifySessionChange(): void {
  listeners.forEach((listener) => listener());
}

/**
 * Notifies subscribers whenever the session is established or dropped, so
 * anything holding a client (a realtime subscription, say) can rebind to the
 * new token instead of quietly running on a stale one.
 *
 * Returns an unsubscribe function.
 */
export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ─── Handshake ────────────────────────────────────────────────────────────────

async function postJson<T>(url: string, body: unknown): Promise<T> {
  // A hung connection must not park the handshake forever. `AbortSignal.timeout`
  // is not in older Safari, so drive an AbortController on a timer instead --
  // an unsupported browser would otherwise throw here rather than time out.
  const controller = new AbortController();
  const timedOutRef = { value: false };
  let fireTimeout!: () => void;
  // Resolves when the deadline passes, so the body read below can race against
  // it. Aborting the request does not reject a body promise that has already
  // been handed back, so the deadline needs its own settleable handle.
  const deadline = new Promise<"timeout">((resolve) => {
    fireTimeout = () => resolve("timeout");
  });
  const timer = setTimeout(() => {
    timedOutRef.value = true;
    controller.abort();
    fireTimeout();
  }, AUTH_REQUEST_TIMEOUT_MS);
  const cancelTimeout = () => clearTimeout(timer);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    cancelTimeout();
    // Distinguish "we gave up waiting" from "the network refused us": the
    // first is worth retrying as-is, the second usually is not.
    const timedOut = timedOutRef.value || (err as Error | null)?.name === "TimeoutError";
    throw new WalletSessionError(
      timedOut
        ? "The SettleX server took too long to respond. Please try signing in again."
        : "Cannot reach the SettleX server to sign in. Please check your connection.",
    );
  }

  // The deadline has to cover reading the body too: a server that sends headers
  // and then stalls would otherwise hang here, past the fetch that the abort
  // signal was watching.
  let payload: unknown = null;
  try {
    const read = await Promise.race([
      response.json().then((value: unknown) => ({ value })),
      deadline,
    ]);
    if (read === "timeout") {
      throw new WalletSessionError(
        "The SettleX server took too long to respond. Please try signing in again.",
      );
    }
    payload = read.value;
  } catch (err) {
    if (err instanceof WalletSessionError) throw err;
    // A malformed body falls through to the status-based message below.
  } finally {
    cancelTimeout();
  }

  if (!response.ok) {
    const message = (payload as { error?: unknown } | null)?.error;
    throw new WalletSessionError(
      typeof message === "string" ? message : `Sign-in failed (HTTP ${response.status}).`,
    );
  }

  return payload as T;
}

async function runHandshake(walletAddress: string): Promise<WalletSession> {
  const epoch = sessionEpoch;
  const challenge = await postJson<{
    transactionXdr: string;
    networkPassphrase: string;
    challengeToken: string;
  }>(CHALLENGE_ENDPOINT, { walletAddress });

  let signedTransactionXdr: string;
  try {
    signedTransactionXdr = await signXDR(challenge.transactionXdr, challenge.networkPassphrase);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    throw new WalletSessionError(
      /reject|denied|cancel|declined/i.test(message)
        ? "Sign-in was cancelled in your wallet."
        : message || "Your wallet could not sign the sign-in request.",
    );
  }

  const verified = await postJson<{ accessToken: string; expiresAt: string }>(VERIFY_ENDPOINT, {
    walletAddress,
    signedTransactionXdr,
    challengeToken: challenge.challengeToken,
  });

  // Derive identity and expiry from the token, not the surrounding JSON, so
  // the stored blob always agrees with what the token actually says.
  const claims = decodeTokenClaims(verified.accessToken);
  if (!claims || claims.walletAddress !== walletAddress) {
    throw new WalletSessionError("The server returned a token for a different wallet.");
  }

  const session: WalletSession = {
    walletAddress: claims.walletAddress,
    accessToken: verified.accessToken,
    expiresAt: claims.expiresAt,
  };

  // A sign-out (or account switch) landed while we were signing. The token is
  // real, but nobody is waiting for it any more -- caching it would resurrect a
  // session the user just ended. Revoke it and report the handshake as void.
  if (epoch !== sessionEpoch) {
    revokeOnServer(session, false);
    throw new WalletSessionError("Sign-in was cancelled.");
  }

  memoizedSession = session;
  storeSession(session);
  notifySessionChange();
  return session;
}

export interface SessionOptions {
  /**
   * Whether the wallet may be prompted for a signature. Pass `false` on
   * background reads so the app never pops a wallet dialog unprompted.
   */
  interactive?: boolean;
}

/**
 * Returns a valid session for `walletAddress`, running the signing handshake if
 * no cached token is usable. Concurrent callers share one handshake, so the
 * wallet is only ever asked to sign once.
 */
export async function getWalletSession(
  walletAddress: string,
  options: SessionOptions = {},
): Promise<WalletSession | null> {
  if (!walletAddress) throw new WalletSessionError("Wallet not connected.");

  // The memoized copy is rebuilt from claims when it is stored, but re-check
  // ownership against the token so this path cannot drift from the stored one.
  const memoized =
    memoizedSession &&
    decodeTokenClaims(memoizedSession.accessToken)?.walletAddress === walletAddress &&
    isFresh(memoizedSession)
      ? memoizedSession
      : null;
  const cached = memoized ?? readStoredSession(walletAddress);

  if (cached) {
    memoizedSession = cached;
    return cached;
  }

  if (options.interactive === false) return null;

  let pending = inFlight.get(walletAddress);
  if (!pending) {
    pending = runHandshake(walletAddress).finally(() => {
      // Only drop our own entry: a later handshake for this address may have
      // replaced it while this one was settling.
      if (inFlight.get(walletAddress) === pending) inFlight.delete(walletAddress);
    });
    inFlight.set(walletAddress, pending);
  }

  const session = await pending;

  // Belt and braces. runHandshake already refuses a token minted for another
  // wallet, but this is the single choke point every caller passes through, so
  // returning a mismatched session here must be impossible by construction
  // rather than by the good behaviour of everything upstream.
  if (session.walletAddress !== walletAddress) {
    throw new WalletSessionError("The session does not belong to the connected wallet.");
  }

  return session;
}

// ─── Authenticated client ─────────────────────────────────────────────────────

let memoizedClient: { token: string; client: SupabaseClient } | null = null;

function buildClient(accessToken: string): SupabaseClient {
  if (memoizedClient?.token === accessToken) return memoizedClient.client;

  if (memoizedClient) {
    void memoizedClient.client.removeAllChannels();
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  // Realtime authorizes on its own socket, so it needs the token too — without
  // this, RLS-guarded change feeds deliver nothing.
  client.realtime.setAuth(accessToken);

  memoizedClient = { token: accessToken, client };
  return client;
}

/**
 * Supabase client bound to a proven wallet identity. Returns `null` only when
 * `interactive: false` was requested and no cached session exists.
 */
export async function getAuthenticatedClient(
  walletAddress: string,
  options: SessionOptions = {},
): Promise<SupabaseClient | null> {
  const session = await getWalletSession(walletAddress, options);
  if (!session) return null;
  return buildClient(session.accessToken);
}

/**
 * Same as `getAuthenticatedClient`, but always prompts when no cached session
 * exists. Use it for writes, where proceeding unauthenticated is never right.
 */
export async function requireAuthenticatedClient(
  walletAddress: string,
): Promise<SupabaseClient> {
  const client = await getAuthenticatedClient(walletAddress, { interactive: true });
  if (!client) throw new WalletSessionError("Wallet sign-in is required.");
  return client;
}

export function getTypedClient() {
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 10 } },
  });
}
