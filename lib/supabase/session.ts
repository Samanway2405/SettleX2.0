/**
 * Wallet-authenticated Supabase sessions.
 *
 * The access token is issued only to an HttpOnly cookie. Browser database
 * requests use the same-origin Next.js proxy, which reads and validates that
 * cookie before forwarding the request to Supabase.
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
} from "@/lib/auth/constants";
import { signXDR } from "@/lib/freighter";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export interface WalletSession {
  walletAddress: string;
  /** Expiry in milliseconds since the epoch. */
  expiresAt: number;
}

/** Raised when the handshake could not complete (rejected signature, etc.). */
export class WalletSessionError extends Error {}

export function isFresh(session: WalletSession, now = Date.now()): boolean {
  return Number.isFinite(session.expiresAt) && session.expiresAt > now;
}

export function isSessionExpiringSoon(session: WalletSession, now = Date.now()): boolean {
  return isFresh(session, now) &&
    session.expiresAt - SESSION_REFRESH_SKEW_SECONDS * 1000 <= now;
}

export function isSessionExpired(session: WalletSession, now = Date.now()): boolean {
  return !Number.isFinite(session.expiresAt) || session.expiresAt <= now;
}

export interface SessionExpiryInfo {
  expiresAt: number;
  secondsRemaining: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
}

export function getSessionExpiryInfo(
  walletAddress: string,
  now = Date.now(),
): SessionExpiryInfo | null {
  const session = memoizedSession;
  if (!session || session.walletAddress !== walletAddress) return null;

  const secondsRemaining = Math.max(0, Math.floor((session.expiresAt - now) / 1000));
  const expired = session.expiresAt <= now;
  return {
    expiresAt: session.expiresAt,
    secondsRemaining,
    isExpiringSoon: !expired &&
      session.expiresAt - SESSION_REFRESH_SKEW_SECONDS * 1000 <= now,
    isExpired: expired,
  };
}

export function hasProvenSession(walletAddress: string): boolean {
  return !!memoizedSession &&
    memoizedSession.walletAddress === walletAddress &&
    isFresh(memoizedSession);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let finishDeadline!: () => void;
  const deadline = new Promise<"timeout">((resolve) => {
    finishDeadline = () => resolve("timeout");
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
    finishDeadline();
  }, AUTH_REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      const result = await Promise.race([
        fetch(url, { ...init, signal: controller.signal, cache: "no-store" }),
        deadline,
      ]);
      if (result === "timeout") {
        throw new WalletSessionError(
          "The SettleX server took too long to respond. Please try signing in again.",
        );
      }
      response = result;
    } catch (error) {
      if (error instanceof WalletSessionError) throw error;
      throw new WalletSessionError(
        timedOut || (error as Error | null)?.name === "AbortError"
          ? "The SettleX server took too long to respond. Please try signing in again."
          : "Cannot reach the SettleX server to sign in. Please check your connection.",
      );
    }

    let payload: unknown;
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
    } catch {
      if (timedOut) {
        throw new WalletSessionError(
          "The SettleX server took too long to respond. Please try signing in again.",
        );
      }
      payload = null;
    }
    if (!response.ok) {
      const message = (payload as { error?: unknown } | null)?.error;
      throw new WalletSessionError(
        typeof message === "string" ? message : `Sign-in failed (HTTP ${response.status}).`,
      );
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

let memoizedSession: WalletSession | null = null;
let memoizedClient: SupabaseClient<Database> | null = null;
let sessionEpoch = 0;
const inFlight = new Map<string, Promise<WalletSession>>();
let sessionLookup: Promise<WalletSession | null> | null = null;

const listeners = new Set<() => void>();

function notifySessionChange(): void {
  listeners.forEach((listener) => listener());
}

export function onSessionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clearLegacyToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_SESSION);
  } catch {
    // Storage may be disabled; no new token is written there.
  }
}

clearLegacyToken();

async function revokeOnServer(everywhere: boolean): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SIGNOUT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ everywhere }),
      keepalive: true,
      cache: "no-store",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function clearWalletSession(
  options: { everywhere?: boolean } = {},
): Promise<{ serverRevoked: boolean }> {
  sessionEpoch += 1;
  memoizedSession = null;
  sessionLookup = null;
  inFlight.clear();
  if (memoizedClient) {
    void memoizedClient.removeAllChannels();
    memoizedClient = null;
  }
  clearLegacyToken();
  notifySessionChange();
  const serverRevoked = await revokeOnServer(options.everywhere === true);
  return { serverRevoked };
}

async function readServerSession(): Promise<WalletSession | null> {
  if (sessionLookup) return sessionLookup;

  const pending = (async () => {
    const result = await requestJson<{
      session: { walletAddress: string; expiresAt: number } | null;
    }>("/api/auth/session", { method: "GET" });
    if (!result.session) return null;

    const { walletAddress, expiresAt } = result.session;
    if (
      typeof walletAddress !== "string" ||
      !walletAddress ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt)
    ) {
      throw new WalletSessionError("The server returned an invalid session.");
    }
    const session = { walletAddress, expiresAt };
    return isFresh(session) ? session : null;
  })();
  sessionLookup = pending;
  try {
    return await pending;
  } finally {
    if (sessionLookup === pending) sessionLookup = null;
  }
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new WalletSessionError(
      /reject|denied|cancel|declined/i.test(message)
        ? "Sign-in was cancelled in your wallet."
        : message || "Your wallet could not sign the sign-in request.",
    );
  }

  const verified = await postJson<{ walletAddress: string; expiresAt: string }>(VERIFY_ENDPOINT, {
    walletAddress,
    signedTransactionXdr,
    challengeToken: challenge.challengeToken,
  });
  const expiresAt = Date.parse(verified.expiresAt);
  if (
    verified.walletAddress !== walletAddress ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new WalletSessionError("The server returned a session for a different wallet.");
  }

  if (epoch !== sessionEpoch) {
    void revokeOnServer(false);
    throw new WalletSessionError("Sign-in was cancelled.");
  }

  const session = { walletAddress, expiresAt };
  memoizedSession = session;
  clearLegacyToken();
  notifySessionChange();
  return session;
}

export interface SessionOptions {
  interactive?: boolean;
  forceRefresh?: boolean;
}

export async function getWalletSession(
  walletAddress: string,
  options: SessionOptions = {},
): Promise<WalletSession | null> {
  if (!walletAddress) throw new WalletSessionError("Wallet not connected.");
  clearLegacyToken();

  if (!options.forceRefresh) {
    if (
      memoizedSession?.walletAddress === walletAddress &&
      isFresh(memoizedSession)
    ) {
      return memoizedSession;
    }

    const epoch = sessionEpoch;
    const existing = await readServerSession();
    if (epoch !== sessionEpoch) {
      throw new WalletSessionError("Sign-in was cancelled.");
    }
    if (existing) {
      memoizedSession = existing;
      if (existing.walletAddress === walletAddress) return existing;
    }
  }

  if (options.interactive === false) return null;

  let pending = inFlight.get(walletAddress);
  if (!pending) {
    pending = runHandshake(walletAddress).finally(() => {
      if (inFlight.get(walletAddress) === pending) inFlight.delete(walletAddress);
    });
    inFlight.set(walletAddress, pending);
  }
  const session = await pending;
  if (session.walletAddress !== walletAddress) {
    throw new WalletSessionError("The session does not belong to the connected wallet.");
  }
  return session;
}

async function supabaseProxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const requestUrl = new URL(request.url);
  const configuredUrl = new URL(supabaseUrl);
  if (requestUrl.origin !== configuredUrl.origin || !requestUrl.pathname.startsWith("/rest/v1/")) {
    throw new WalletSessionError("Only Supabase REST requests can use the authenticated proxy.");
  }
  if (typeof window === "undefined") {
    throw new WalletSessionError("Authenticated database requests are only available in the browser.");
  }

  const proxyUrl = new URL(
    `/api/supabase/${requestUrl.pathname.slice(1)}${requestUrl.search}`,
    window.location.origin,
  );
  const headers = new Headers(request.headers);
  headers.delete("authorization");
  headers.delete("apikey");

  return fetch(proxyUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    signal: request.signal,
    credentials: "same-origin",
    cache: "no-store",
  });
}

function buildClient(): SupabaseClient<Database> {
  if (memoizedClient) return memoizedClient;
  memoizedClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: supabaseProxyFetch },
  });
  return memoizedClient;
}

export async function getAuthenticatedClient(
  walletAddress: string,
  options: SessionOptions = {},
): Promise<SupabaseClient<Database> | null> {
  const session = await getWalletSession(walletAddress, options);
  return session ? buildClient() : null;
}

export async function requireAuthenticatedClient(
  walletAddress: string,
): Promise<SupabaseClient<Database>> {
  const client = await getAuthenticatedClient(walletAddress, { interactive: true });
  if (!client) throw new WalletSessionError("Wallet sign-in is required.");
  return client;
}
