"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  clearWalletSession,
  getAuthenticatedClient,
  getSessionExpiryInfo,
  onSessionChange,
  requireAuthenticatedClient,
} from "@/lib/supabase/session";
import { useWalletContext } from "./WalletContext";
import { getWalletScopedKey, LS_PUBLIC_KEY, LS_USER } from "@/lib/utils/constants";
import { parseUserRow } from "@/lib/supabase/rowGuards";
import { useToast } from "@/components/ui/Toast";
import { reportError } from "@/lib/observability/logger";
import { supabaseErrorFields } from "@/lib/observability/supabaseError";
import { userFacingMessage } from "@/lib/errors/userMessage";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  walletAddress: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /**
   * Set when the wallet could not prove ownership of its key (signature
   * declined, server unreachable). Every database call fails while this is set,
   * so the UI should ask the user to re-authenticate rather than carry on.
   */
  sessionError: string | null;
  /** Whether the session is inside the expiry warning window or has expired. */
  isSessionExpiring: boolean;
  /** Whether the session has passed its expiration time. */
  isSessionExpired: boolean;
  /** Seconds until the session expires, or 0 if expired, or null if unauthenticated. */
  sessionSecondsRemaining: number | null;
  /** True while the user is confirming a re-auth signature prompt. */
  isSigningToContinue: boolean;
  /** Prompts the wallet to sign and re-authenticate an expiring or expired session. */
  signToContinue: () => Promise<void>;
  signUp: (displayName: string) => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-runs the wallet signing handshake. */
  refreshSession: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<User, "displayName">>) => Promise<void>;
  resolveUserProfile: (walletAddress: string) => Promise<string | null>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);
AuthContext.displayName = "AuthContext";

// ─── Helper: Convert DB row to User ───────────────────────────────────────────

function dbRowToUser(row: unknown): User {
  const parsed = parseUserRow(row);
  return {
    id: parsed.id,
    walletAddress: parsed.walletAddress,
    displayName: parsed.displayName,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    lastLoginAt: parsed.lastLoginAt,
  };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

// ─── localStorage helpers ────────────────────────────────────────────────────

function saveUserToCache(user: User) {
  try {
    localStorage.setItem(getWalletScopedKey(LS_USER, user.walletAddress), JSON.stringify(user));
  } catch {}
}

/**
 * Reads the cached profile for one wallet, and only that wallet.
 *
 * There is deliberately no fallback to the legacy unscoped `LS_USER` key: that
 * entry may have been written by a different account on this browser, and
 * serving it to whoever connects next is the cross-wallet leak this scoping
 * exists to prevent. With no wallet address there is nothing to scope to, so
 * there is nothing safe to return.
 */
function loadUserFromCache(walletAddress?: string | null): User | null {
  if (!walletAddress) return null;
  try {
    const raw = localStorage.getItem(getWalletScopedKey(LS_USER, walletAddress));
    return raw ? (JSON.parse(raw) as User) : null;
  } catch { return null; }
}

function clearUserCache(walletAddress?: string | null) {
  try {
    if (walletAddress) {
      localStorage.removeItem(getWalletScopedKey(LS_USER, walletAddress));
    }
    localStorage.removeItem(LS_USER);
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    // Render hint only — shows the user's name instead of a flash of empty UI
    // on refresh. It is NOT evidence of anything: `isAuthenticated` below
    // ignores it entirely, and every request is authorized by the signed token.
    //
    // The wallet context has not run yet at this point, so the address comes
    // straight from storage. It only ever selects *which* wallet's cache to
    // read, so a hand-edited value surfaces that wallet's own cached profile
    // and nothing else.
    if (typeof window === "undefined") return null;
    try {
      return loadUserFromCache(localStorage.getItem(LS_PUBLIC_KEY));
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // Bumped by refreshSession() to re-run the handshake effect below.
  const [sessionNonce, setSessionNonce] = useState(0);
  // Set only after the wallet has signed a server-issued challenge and the
  // server has minted a token for this exact address.
  const [verifiedWallet, setVerifiedWallet] = useState<string | null>(null);
  const [isSessionExpiring, setIsSessionExpiring] = useState(false);
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [sessionSecondsRemaining, setSessionSecondsRemaining] = useState<number | null>(null);
  const [isSigningToContinue, setIsSigningToContinue] = useState(false);
  const { publicKey, isConnected, isHydrated } = useWalletContext();

  // Authorization rests on the verified token, never on cached state. Writing
  // `settlex:user` and `settlex:publicKey` by hand now buys nothing: without a
  // signature the server issues no token, so this stays false and every
  // database call is rejected by RLS regardless.
  const isAuthenticated =
    !!user && isConnected && !!verifiedWallet && verifiedWallet === publicKey;

  // ── Load user profile when wallet connects ────────────────────────────────────────────────────────

  useEffect(() => {
    // Wait for wallet hydration to complete before making auth decisions
    if (!isHydrated) return;

    if (!publicKey) {
      setUser(null);
      clearUserCache(publicKey);
      clearWalletSession();
      setVerifiedWallet(null);
      setSessionError(null);
      setIsLoading(false);
      return;
    }

    // A different address than the one we verified means the wallet switched
    // accounts. Revoke immediately — before any await — so no render can slip
    // through with the old identity still marked authenticated.
    setVerifiedWallet((current) => (current === publicKey ? current : null));

    async function loadUser(wallet: string) {
      // Prove key ownership before touching the database — the profile table is
      // readable only by an authenticated wallet. This prompts the wallet to
      // sign once per session, not once per page load.
      const client = await getAuthenticatedClient(wallet).catch((err: unknown) => {
        // Displayed in the UI, so it is vetted first: a handshake failure can
        // carry a 503 body or transport text rather than anything a user can act
        // on. The full error goes to the reporter.
        reportError("auth.session_handshake_failed", err);
        setSessionError(userFacingMessage(err).message);
        return null;
      });

      if (!client) {
        setVerifiedWallet(null);
        setIsLoading(false);
        return;
      }

      // The token exists and its `wallet_address` claim was signed by the
      // server for this address — that, and only that, is what authorizes.
      setVerifiedWallet(wallet);
      setSessionError(null);

      try {
        const { data, error } = await client
          .from("users")
          .select("*")
          .eq("wallet_address", wallet)
          .single();

        if (error) {
          if (error.code === "PGRST116") {
            // No user found - user needs to sign up
            setUser(null);
            clearUserCache(wallet);
          }
          // On network errors, keep the cached user (don't log out)
        } else if (data) {
          const loadedUser = dbRowToUser(data);
          setUser(loadedUser);
          saveUserToCache(loadedUser);
        }
      } catch (err) {
        // Network error - keep cached user so user stays logged in
      } finally {
        setIsLoading(false);
      }
    }

    loadUser(publicKey);
  }, [publicKey, isHydrated, sessionNonce]);

  // ── Monitor session expiry for proactive warning and prompt ───────────────

  useEffect(() => {
    if (!publicKey || !verifiedWallet || verifiedWallet !== publicKey) {
      setIsSessionExpiring(false);
      setIsSessionExpired(false);
      setSessionSecondsRemaining(null);
      return;
    }

    const checkExpiry = () => {
      const info = getSessionExpiryInfo(publicKey);
      if (!info) {
        setIsSessionExpiring(false);
        setIsSessionExpired(false);
        setSessionSecondsRemaining(null);
        return;
      }

      setSessionSecondsRemaining(info.secondsRemaining);
      setIsSessionExpired(info.isExpired);
      setIsSessionExpiring(info.isExpiringSoon || info.isExpired);
    };

    checkExpiry();
    const interval = setInterval(checkExpiry, 5000);
    const unsubscribe = onSessionChange(checkExpiry);

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [publicKey, verifiedWallet]);

  // ── Sign up: Create new user profile ──────────────────────────────────────

  const signUp = useCallback(
    async (displayName: string) => {
      if (!publicKey) {
        throw new Error("Wallet not connected");
      }

      if (!displayName || !displayName.trim()) {
        throw new Error("Display name is required");
      }

      if (displayName.trim().length > 50) {
        throw new Error("Display name cannot exceed 50 characters");
      }

      try {
        const client = await requireAuthenticatedClient(publicKey);
        setVerifiedWallet(publicKey);
        setSessionError(null);

        const { data, error } = await client
          .from("users")
          .insert({
            wallet_address: publicKey,
            display_name: displayName.trim(),
          })
          .select()
          .single();

        if (error) {
          if (error.code === '23505') {
            throw new Error("This wallet is already registered. Please sign in instead.");
          } else if (error.code === '23514') {
            throw new Error("Display name must be between 1 and 50 characters.");
          } else if (error.message.includes('permission denied') || error.message.includes('policy')) {
            throw new Error("Access denied. Please make sure your database is properly configured.");
          } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            throw new Error("Cannot connect to the server. Please check your internet connection.");
          } else {
            // The branches above translate the cases we know about. Anything
            // else is raw PostgREST text (schema names, policy details), so it
            // is logged rather than shown — see lib/errors/userMessage.
            reportError("auth.signup_failed", error, {
              fields: supabaseErrorFields(error),
            });
            throw new Error("Failed to create account. Please try again.");
          }
        }

        if (data) {
          const newUser = dbRowToUser(data);
          setUser(newUser);
          saveUserToCache(newUser);
        }
      } catch (err: unknown) {
        // Check for network errors
        const errMsg = err instanceof Error ? err.message : "";
        const errName = err instanceof Error ? err.name : "";
        if (errMsg.includes('Failed to fetch') || errName === 'TypeError') {
          throw new Error("Cannot connect to server. Please check your internet connection or try again later.");
        }
        throw err;
      }
    },
    [publicKey]
  );

  // ── Sign in: Update last login time ───────────────────────────────────────

  const signIn = useCallback(async () => {
    if (!publicKey) {
      throw new Error("Wallet not connected");
    }

    try {
      // The JWT minted by the signing handshake is what RLS authorizes on.
      const client = await requireAuthenticatedClient(publicKey);
      setVerifiedWallet(publicKey);
      setSessionError(null);

      const { data, error } = await client
        .from("users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("wallet_address", publicKey)
        .select()
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          throw new Error("No account found. Please sign up first.");
        }
        if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
          throw new Error("Cannot connect to server. Please check your internet connection.");
        }
        reportError("auth.signin_failed", error, { fields: supabaseErrorFields(error) });
        throw new Error("Sign in failed. Please try again.");
      }

      if (data) {
        const signedInUser = dbRowToUser(data);
        setUser(signedInUser);
        saveUserToCache(signedInUser);
      }
    } catch (err: unknown) {
      // Check for network errors
      const errMsg = err instanceof Error ? err.message : "";
      const errName = err instanceof Error ? err.name : "";
      if (errMsg.includes('Failed to fetch') || errName === 'TypeError') {
        throw new Error("Cannot connect to server. Please check your internet connection and try again.");
      }
      throw err;
    }
  }, [publicKey]);

  // ── Sign out: Clear user state ──────────────────────────────────────────

  const { error: toastError } = useToast();

  const signOut = useCallback(async () => {
    // Always clear locally first — the user must not be trapped in a session
    // because of a network blip. Revocation is awaited so we can surface a
    // warning without blocking the sign-out itself.
    setUser(null);
    clearUserCache(publicKey);
    setVerifiedWallet(null);
    setSessionError(null);
    setIsSessionExpiring(false);
    setIsSessionExpired(false);
    setSessionSecondsRemaining(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LS_USER);
    }

    const { serverRevoked } = await clearWalletSession();
    if (!serverRevoked) {
      reportError("auth.signout_server_revocation_failed", undefined, {
        fields: { walletAddress: publicKey ?? undefined },
      });
      toastError(
        "Signed out on this device",
        "The server could not revoke your session — it will expire automatically.",
      );
    }
  }, [publicKey, toastError]);

  // ── Refresh session: re-run the wallet signing handshake ──────────────────

  const refreshSession = useCallback(async () => {
    clearWalletSession();
    setVerifiedWallet(null);
    setSessionError(null);
    setIsLoading(true);
    setSessionNonce((n) => n + 1);
  }, []);

  // ── Sign to continue: re-authenticate session with wallet prompt ──────────

  const signToContinue = useCallback(async () => {
    if (!publicKey) return;
    try {
      setIsSigningToContinue(true);
      await getAuthenticatedClient(publicKey, { interactive: true, forceRefresh: true });
      setVerifiedWallet(publicKey);
      setSessionError(null);
    } catch (err: unknown) {
      reportError("auth.reauth_failed", err);
      const msg = userFacingMessage(err).message;
      setSessionError(msg);
      toastError("Session Renewal Failed", msg);
    } finally {
      setIsSigningToContinue(false);
    }
  }, [publicKey, toastError]);

  // ── Update profile ─────────────────────────────────────────────────────────

  const updateProfile = useCallback(
    async (updates: Partial<Pick<User, "displayName">>) => {
      if (!publicKey || !user) {
        throw new Error("Not authenticated");
      }

      if (updates.displayName !== undefined) {
        if (!updates.displayName.trim()) {
          throw new Error("Display name is required");
        }
        if (updates.displayName.trim().length > 50) {
          throw new Error("Display name cannot exceed 50 characters");
        }
      }

      try {
        const client = await requireAuthenticatedClient(publicKey);
        setVerifiedWallet(publicKey);
        setSessionError(null);

        const { data, error } = await client
          .from("users")
          .update({
            display_name: updates.displayName ?? user.displayName,
          })
          .eq("wallet_address", publicKey)
          .select()
          .single();

        if (error) {
          reportError("auth.profile_update_failed", error, {
            fields: supabaseErrorFields(error),
          });
          throw new Error("Failed to update profile. Please try again.");
        }

        if (data) {
          const updatedUser = dbRowToUser(data);
          setUser(updatedUser);
          saveUserToCache(updatedUser);
        }
      } catch (err: unknown) {
        throw err;
      }
    },
    [publicKey, user]
  );

  // ── Resolve profile: look up verified display name ────────────────────────

  const resolveUserProfile = useCallback(
    async (walletAddress: string): Promise<string | null> => {
      if (!publicKey || !walletAddress || !walletAddress.trim()) return null;
      try {
        const client = await requireAuthenticatedClient(publicKey);
        const { data, error } = await client.rpc("resolve_user_profile", {
          p_wallet_address: walletAddress.trim(),
        });
        if (error || !data || data.length === 0) return null;
        return data[0].display_name;
      } catch {
        return null;
      }
    },
    [publicKey]
  );

  // ──────────────────────────────────────────────────────────────────────────

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated,
    sessionError,
    isSessionExpiring,
    isSessionExpired,
    sessionSecondsRemaining,
    isSigningToContinue,
    signToContinue,
    signUp,
    signIn,
    signOut,
    refreshSession,
    updateProfile,
    resolveUserProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
