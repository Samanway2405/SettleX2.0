"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { stellarNetworkLabel } from "@/lib/utils/constants";

export function NetworkGuardBanner() {
  const {
    isConnected,
    network,
    expectedNetwork,
    networkStatus,
    refreshNetwork,
  } = useWallet();

  if (
    !isConnected ||
    networkStatus === "idle" ||
    networkStatus === "matched"
  ) {
    return null;
  }

  const isChecking = networkStatus === "checking";
  const detail =
    networkStatus === "mismatched" && network
      ? `Your wallet is on ${stellarNetworkLabel(network)}, but SettleX is configured for ${stellarNetworkLabel(expectedNetwork)}.`
      : `SettleX could not verify the selected wallet's network. Switch it to ${stellarNetworkLabel(expectedNetwork)}, then check again.`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-[100] border-b border-[#DC2626]/30 bg-[#FEF2F2] px-4 py-3 text-[#7F1D1D] shadow-sm"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">Payments are blocked</p>
            <p className="mt-0.5 text-xs leading-5 text-[#991B1B]">{detail}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshNetwork()}
          disabled={isChecking}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#DC2626]/30 bg-white px-3 py-2 text-xs font-bold text-[#991B1B] transition-colors hover:bg-[#FEE2E2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${isChecking ? "animate-spin" : ""}`} aria-hidden="true" />
          {isChecking ? "Checking network" : "Check again"}
        </button>
      </div>
    </div>
  );
}
