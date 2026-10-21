"use client";

import { AlertCircle, Clock, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

/**
 * Banner displayed when an active session is nearing expiration or has expired.
 *
 * Prompts the user to re-authenticate with a wallet signature so that background
 * reads, writes, and realtime change feeds continue without interruption.
 */
export function SessionExpiryBanner() {
  const {
    isAuthenticated,
    isSessionExpiring,
    isSessionExpired,
    sessionSecondsRemaining,
    isSigningToContinue,
    signToContinue,
  } = useAuth();

  if (!isAuthenticated || !isSessionExpiring) {
    return null;
  }

  const minutesRemaining =
    sessionSecondsRemaining !== null
      ? Math.max(1, Math.ceil(sessionSecondsRemaining / 60))
      : 5;

  const title = isSessionExpired
    ? "Session expired"
    : "Session expiring soon";

  const detail = isSessionExpired
    ? "Your session has expired. Sign to continue receiving realtime updates and making changes."
    : `Your session will expire in ~${minutesRemaining} ${minutesRemaining === 1 ? "minute" : "minutes"}. Sign to continue without losing live updates.`;

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`sticky top-0 z-[95] border-b px-4 py-3 shadow-sm transition-colors ${
        isSessionExpired
          ? "border-[#DC2626]/30 bg-[#FEF2F2] text-[#7F1D1D]"
          : "border-[#F59E0B]/30 bg-[#FFFBEB] text-[#92400E]"
      }`}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {isSessionExpired ? (
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-[#DC2626]"
              aria-hidden="true"
            />
          ) : (
            <Clock
              className="mt-0.5 h-5 w-5 shrink-0 text-[#D97706]"
              aria-hidden="true"
            />
          )}
          <div>
            <p className="text-sm font-bold">{title}</p>
            <p
              className={`mt-0.5 text-xs leading-5 ${
                isSessionExpired ? "text-[#991B1B]" : "text-[#B45309]"
              }`}
            >
              {detail}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void signToContinue()}
          disabled={isSigningToContinue}
          className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 ${
            isSessionExpired
              ? "border-[#DC2626]/30 bg-white text-[#991B1B] hover:bg-[#FEE2E2] focus-visible:ring-[#DC2626]"
              : "border-[#F59E0B]/30 bg-white text-[#B45309] hover:bg-[#FEF3C7] focus-visible:ring-[#F59E0B]"
          }`}
        >
          <RefreshCw
            className={`h-4 w-4 ${isSigningToContinue ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          {isSigningToContinue ? "Signing..." : "Sign to continue"}
        </button>
      </div>
    </div>
  );
}
