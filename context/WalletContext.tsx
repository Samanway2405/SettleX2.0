"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isFreighterInstalled } from "@/lib/freighter";
import { getWalletsKit, FREIGHTER_ID, type WalletId } from "@/lib/stellar/walletsKit";
import { getXLMBalance } from "@/lib/stellar/getBalance";
import {
  clearAppCaches,
  LS_PUBLIC_KEY,
  LS_WALLET_ID,
  STELLAR_NETWORK,
  stellarNetworkLabel,
  type StellarNetwork,
} from "@/lib/utils/constants";
import { clearWalletSession } from "@/lib/supabase/session";
import type { WalletContextType, WalletNetworkStatus } from "@/types/wallet";
import { useToast } from "@/components/ui/Toast";
import { reportError } from "@/lib/observability/logger";
import { userFacingMessage } from "@/lib/errors/userMessage";


const WalletContext = createContext<WalletContextType | null>(null);
WalletContext.displayName = "WalletContext";

/**
 * Drops every trace of the connected wallet, including the verified session
 * token. Anything derived from an address we can no longer vouch for has to go
 * with it, or the next request would carry a token for the wrong account.
 */
function clearStoredWallet(walletAddress?: string | null) {
  try {
    localStorage.removeItem(LS_PUBLIC_KEY);
    localStorage.removeItem(LS_WALLET_ID);
  } catch {
    // Private-mode browsers refuse writes — in-memory state is still cleared.
  }
  clearAppCaches(walletAddress);
  clearWalletSession();
}


export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [publicKey, setPublicKey]           = useState<string | null>(null);
  const [balance, setBalance]               = useState<string | null>(null);
  const [network, setNetwork]               = useState<StellarNetwork | null>(null);
  const [networkStatus, setNetworkStatus]   = useState<WalletNetworkStatus>("idle");
  const [isConnecting, setIsConnecting]     = useState(false);
  const [isLoadingBalance, setLoadingBal]   = useState(false);
  const [isHydrated, setIsHydrated]         = useState(false);
  const [error, setError]                   = useState<string | null>(null);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);

  const isConnected = !!publicKey;
  const didMount    = useRef(false);
  const { error: toastError, success: toastSuccess, info: toastInfo } = useToast();

  const fetchBalance = useCallback(async (pk: string, silent = false) => {
    if (!silent) setLoadingBal(true);
    try {
      const bal = await getXLMBalance(pk);
      setBalance(bal);
    } catch {
      // keep last known balance on transient errors
    } finally {
      if (!silent) setLoadingBal(false);
    }
  }, []);

  const checkWalletNetwork = useCallback(async (
    walletId: WalletId,
    showChecking = true,
  ): Promise<StellarNetwork | null> => {
    if (showChecking) setNetworkStatus("checking");
    try {
      const kit = getWalletsKit();
      kit.setWallet(walletId);
      const net = await kit.getNetworkFromWallet();
      setNetwork(net);
      setNetworkStatus(net === STELLAR_NETWORK ? "matched" : "mismatched");
      return net;
    } catch {
      // Do not replace a failed wallet read with the app default. That would
      // turn "unknown" into a false match and allow a transaction to proceed.
      setNetwork(null);
      setNetworkStatus("unavailable");
      return null;
    }
  }, []);

  // ── Auto-reconnect from localStorage ───────────────────────────────────────

  useEffect(() => {
    if (didMount.current) return;
    didMount.current = true;

    const savedKey = typeof window !== "undefined"
      ? localStorage.getItem(LS_PUBLIC_KEY)
      : null;
    const savedWalletId = (typeof window !== "undefined"
      ? localStorage.getItem(LS_WALLET_ID)
      : null) as WalletId | null;

    if (!savedKey) {
      // No saved key — nothing to restore, mark hydration done immediately
      setIsHydrated(true);
      return;
    }

    const walletId = savedWalletId ?? FREIGHTER_ID;
    // Bind after the null guard above so the async closure keeps the narrowing.
    const restoredKey: string = savedKey;

    async function hydrate() {
      // Point the kit at the wallet the user actually connected with, so signing
      // after a reload goes to the right extension (not always Freighter).
      try {
        getWalletsKit().setWallet(walletId);
      } catch {
        /* SSR guard — never reached in this client effect */
      }

      if (walletId === FREIGHTER_ID && !(await isFreighterInstalled())) {
        clearStoredWallet();
        setIsHydrated(true);
        return;
      }

      // The saved key is caller-supplied data, not evidence. Ask the extension
      // which account is actually selected and drop the session if it disagrees
      // — this is what stops a hand-written localStorage entry from restoring an
      // arbitrary identity, and what catches an account switch made while the
      // tab was closed.
      const liveKey = await getWalletsKit()
        .getAddressSilently()
        .catch(() => null);

      if (liveKey && liveKey !== restoredKey) {
        clearStoredWallet(restoredKey);
        setIsHydrated(true);
        toastInfo(
          "Wallet account changed",
          "Please reconnect to continue with your current account."
        );
        return;
      }

      // `liveKey === null` means the extension could not answer without a
      // popup. Restore optimistically so the UI can render, but nothing is
      // authorized on this key: every privileged call goes through a signed
      // challenge, which fails if the wallet no longer holds this address.
      setPublicKey(restoredKey);
      setSelectedWalletId(walletId);
      fetchBalance(restoredKey);
      void checkWalletNetwork(walletId);
      setIsHydrated(true);
    }

    hydrate().catch(() => {
      // Never leave the app stuck on the hydration spinner.
      clearStoredWallet();
      setIsHydrated(true);
    });
  }, [checkWalletNetwork, fetchBalance, toastInfo]);

  // ── Detect account switches while the tab is open ──────────────────────────
  // Extensions do not emit a standard account-change event, so poll the silent
  // read. A switch mid-session must not leave the app acting as the old account
  // while the wallet signs as the new one.

  const reconcile = useCallback(async () => {
    if (!publicKey) return;
    const liveKey = await getWalletsKit()
      .getAddressSilently()
      .catch(() => null);

    if (!liveKey || liveKey === publicKey) return;

    clearStoredWallet(publicKey);
    setPublicKey(null);
    setBalance(null);
    setNetwork(null);
    setSelectedWalletId(null);
    toastInfo(
      "Wallet account changed",
      "Please reconnect to continue with your current account."
    );
  }, [publicKey, toastInfo]);

  useEffect(() => {
    if (!publicKey) return;

      clearStoredWallet(publicKey);
      setPublicKey(null);
      setBalance(null);
      setNetwork(null);
      setNetworkStatus("idle");
      setSelectedWalletId(null);
      toastInfo(
        "Wallet account changed",
        "Please reconnect to continue with your current account."
      );
    };

    timeoutId = setTimeout(tick, 5_000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timeoutId);
        void reconcile();
        timeoutId = setTimeout(tick, 5_000);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [checkWalletNetwork, publicKey, selectedWalletId, toastInfo]);

  useEffect(() => {
    if (!publicKey) return;

    const interval = setInterval(() => {
      fetchBalance(publicKey, true);
    }, 15_000);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchBalance(publicKey, true);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [publicKey, fetchBalance]);


  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // The kit modal handles per-wallet install detection, so we no longer
      // hard-gate on Freighter — any supported wallet can connect.
      const kit = getWalletsKit();
      let resolvedAddress = "";
      let chosenWalletId: WalletId = FREIGHTER_ID;
      let walletError: Error | null = null;

      await kit.openModal({
        modalTitle: "Connect Your Stellar Wallet",
        notAvailableText: "Install extension",

        onWalletSelected: async (wallet) => {
          kit.setWallet(wallet.id);
          chosenWalletId = wallet.id;
          const { address } = await kit.getAddress();
          resolvedAddress = address;
        },

        onClosed: () => {
          if (!resolvedAddress) walletError = new Error("Wallet selection cancelled.");
        },
      });

      if (walletError || !resolvedAddress) return;

      const net = await checkWalletNetwork(chosenWalletId);

      setPublicKey(resolvedAddress);
      setSelectedWalletId(chosenWalletId);
      localStorage.setItem(LS_PUBLIC_KEY, resolvedAddress);
      localStorage.setItem(LS_WALLET_ID, chosenWalletId);
      toastSuccess(
        "Wallet connected",
        net
          ? `${resolvedAddress.slice(0, 6)}…${resolvedAddress.slice(-4)} on ${stellarNetworkLabel(net)}`
          : `${resolvedAddress.slice(0, 6)}…${resolvedAddress.slice(-4)} · network not verified`,
      );
      if (net !== STELLAR_NETWORK) {
        toastError(
          net ? "Wrong Stellar network" : "Wallet network unavailable",
          net
            ? `Switch your wallet to ${stellarNetworkLabel(STELLAR_NETWORK)} before making a payment.`
            : "SettleX could not verify this wallet's network. Payments remain blocked.",
        );
      }

      fetchBalance(resolvedAddress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect wallet.";
      // Matched against the raw text: the wallet extensions' own cancellation
      // wording is what identifies a user backing out, and that is not shown.
      const isCancelled =
        msg.toLowerCase().includes("cancel") ||
        msg.toLowerCase().includes("closed without");
      if (!isCancelled) {
        // Vetted before display — a connect failure can surface extension
        // internals or transport text.
        const display = userFacingMessage(err).message;
        reportError("wallet.connect_failed", err);
        setError(display);
        toastError("Connection failed", display);
      }
    } finally {
      setIsConnecting(false);
    }
  }, [checkWalletNetwork, fetchBalance, toastError, toastSuccess]);


  const disconnect = useCallback(() => {
    setPublicKey(null);
    setBalance(null);
    setNetwork(null);
    setNetworkStatus("idle");
    setError(null);
    setSelectedWalletId(null);
    toastInfo("Wallet disconnected");
    // Also drops LS_WALLET_ID and the verified session token — leaving either
    // behind would let the next load restore a half-session.
    clearStoredWallet(publicKey);
  }, [publicKey, toastInfo]);


  const refreshBalance = useCallback(async () => {
    if (!publicKey) return;
    await fetchBalance(publicKey);
  }, [publicKey, fetchBalance]);

  const refreshNetwork = useCallback(async () => {
    if (!selectedWalletId) return null;
    return checkWalletNetwork(selectedWalletId as WalletId);
  }, [checkWalletNetwork, selectedWalletId]);

  const clearError = useCallback(() => setError(null), []);

  const value: WalletContextType = {
    publicKey,
    balance,
    network,
    expectedNetwork: STELLAR_NETWORK,
    networkStatus,
    isNetworkCompatible: isConnected && networkStatus === "matched",
    networkMismatch: isConnected && networkStatus === "mismatched",
    isConnected,
    isConnecting,
    isHydrated,
    isLoadingBalance,
    error,
    selectedWalletId,
    connect,
    disconnect,
    refreshBalance,
    refreshNetwork,
    clearError,
    reconcile,
  };

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWalletContext(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within <WalletProvider />");
  return ctx;
}
