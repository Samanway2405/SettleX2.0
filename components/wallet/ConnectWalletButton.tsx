"use client";

import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wallet,
  ChevronDown,
  Copy,
  Check,
  RefreshCw,
  LogOut,
  ExternalLink,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { Spinner } from "@/components/ui/Spinner";
import { formatAddress, formatXLM } from "@/lib/utils";
import { STELLAR_EXPLORER, type StellarNetwork } from "@/lib/utils/constants";
import { cn } from "@/lib/utils";

// ─── Network badge colour ─────────────────────────────────────────────────────

function NetworkBadge({ network }: { network: StellarNetwork | null }) {
  const isMainnet = network === "PUBLIC";
  const isUnverified = network === null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md",
        isUnverified
          ? "bg-[#FEF2F2] text-[#991B1B]"
          : isMainnet
          ? "bg-blue-100 text-blue-600"
          : "bg-[#B9FF66]/20 text-[#2D6600]"
      )}
    >
      <span
        className={cn(
          "w-1 h-1 rounded-full",
          isUnverified
            ? "bg-[#DC2626]"
            : isMainnet
              ? "bg-blue-600"
              : "bg-[#2D6600] animate-pulse"
        )}
      />
      {isUnverified ? "Unverified" : isMainnet ? "Mainnet" : "Testnet"}
    </span>
  );
}

// ─── Dropdown menu ────────────────────────────────────────────────────────────

interface WalletDropdownProps {
  publicKey: string;
  balance: string | null;
  network: StellarNetwork | null;
  isLoadingBalance: boolean;
  onRefreshBalance: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}

function WalletDropdown({
  publicKey,
  balance,
  network,
  isLoadingBalance,
  onRefreshBalance,
  onDisconnect,
  onClose,
}: WalletDropdownProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const explorerUrl = `${STELLAR_EXPLORER}/account/${publicKey}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl border border-[#E5E5E5] shadow-[0_8px_40px_-8px_rgba(0,0,0,0.15)] overflow-hidden z-[100]"
    >
      {/* Header */}
      <div className="px-4 py-3 bg-[#F6F6F6] border-b border-[#E5E5E5]">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#AAA]">
            Connected Wallet
          </p>
          <NetworkBadge network={network} />
        </div>

        {/* Address row */}
        <div className="flex items-center gap-2">
          <p className="text-sm font-mono font-semibold text-[#0F0F14] flex-1 truncate">
            {formatAddress(publicKey, 8)}
          </p>
          <button
            onClick={handleCopy}
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#E5E5E5] transition-colors"
            title="Copy address"
          >
            {copied ? (
              <Check size={13} className="text-[#2D6600]" />
            ) : (
              <Copy size={13} className="text-[#888]" />
            )}
          </button>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[#E5E5E5] transition-colors"
            title="View on Stellar Explorer"
          >
            <ExternalLink size={13} className="text-[#888]" />
          </a>
        </div>
      </div>

      {/* Balance row */}
      <div className="px-4 py-3 border-b border-[#E5E5E5]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-[#AAA] font-medium mb-0.5">
              XLM Balance
            </p>
            {isLoadingBalance ? (
              <Spinner size={14} className="text-[#B9FF66]" />
            ) : (
              <p className="text-lg font-black text-[#0F0F14]">
                {balance ? `${formatXLM(balance)} XLM` : "—"}
              </p>
            )}
          </div>
          <button
            onClick={onRefreshBalance}
            disabled={isLoadingBalance}
            className="flex items-center justify-center w-8 h-8 rounded-xl hover:bg-[#F0F0F0] transition-colors disabled:opacity-40"
            title="Refresh balance"
          >
            <RefreshCw
              size={14}
              className={cn(
                "text-[#888]",
                isLoadingBalance && "animate-spin"
              )}
            />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="p-2">
        <button
          onClick={() => {
            onDisconnect();
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-red-500 rounded-xl hover:bg-red-50 transition-colors"
        >
          <LogOut size={15} />
          Disconnect Wallet
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface ConnectWalletButtonProps {
  /** Compact mode for mobile menus — shows text only, no balance */
  compact?: boolean;
  className?: string;
}

export function ConnectWalletButton({
  compact = false,
  className,
}: ConnectWalletButtonProps) {
  const {
    publicKey,
    balance,
    network,
    isConnected,
    isConnecting,
    isLoadingBalance,
    error,
    connect,
    disconnect,
    refreshBalance,
    clearError,
  } = useWallet();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ── Connected ──────────────────────────────────────────────────────────────

  if (isConnected && publicKey) {
    if (compact) {
      return (
        <div className={cn("flex flex-col gap-1.5", className)}>
          <div className="flex items-center gap-2 px-3 py-2 bg-[#F6F6F6] rounded-xl border border-[#E5E5E5]">
            <div className="w-2 h-2 rounded-full bg-[#B9FF66] animate-pulse" />
            <span className="text-sm font-mono font-medium text-[#0F0F14] flex-1 truncate">
              {formatAddress(publicKey, 6)}
            </span>
            {balance && (
              <span className="text-xs font-semibold text-[#2D6600]">
                {formatXLM(balance)} XLM
              </span>
            )}
          </div>
          <button
            onClick={disconnect}
            className="w-full px-3 py-2 text-sm font-medium text-red-500 rounded-xl border border-red-100 hover:bg-red-50 transition-colors text-left flex items-center gap-2"
          >
            <LogOut size={14} />
            Disconnect
          </button>
        </div>
      );
    }

    return (
      <div ref={ref} className={cn("relative", className)}>
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className={cn(
            "inline-flex items-center gap-2 pl-1 pr-2 sm:pr-3 py-1.5 rounded-xl border transition-all duration-200 max-w-[180px] sm:max-w-none",
            "bg-white border-[#E5E5E5] hover:border-[#B9FF66]/60 hover:shadow-[0_2px_12px_-2px_rgba(185,255,102,0.3)]"
          )}
        >
          {/* Avatar dot */}
          <div className="w-7 h-7 rounded-lg bg-[#B9FF66] flex items-center justify-center">
            <Wallet size={13} className="text-[#0F0F14]" />
          </div>

          {/* Address */}
          <div className="hidden sm:block text-left">
            <p className="text-[11px] text-[#AAA] leading-none mb-0.5">Connected</p>
            <p className="text-xs font-mono font-semibold text-[#0F0F14] leading-none">
              {formatAddress(publicKey, 5)}
            </p>
          </div>

          <span className="sm:hidden inline-flex items-center w-2 h-2 rounded-full bg-[#2D6600]" />

          {/* Balance pill */}
          {!isLoadingBalance && balance && (
            <span className="hidden sm:flex items-center text-[11px] font-bold text-[#2D6600] bg-[#B9FF66]/15 px-2 py-0.5 rounded-lg">
              {formatXLM(balance)} XLM
            </span>
          )}
          {isLoadingBalance && (
            <Spinner size={12} className="text-[#B9FF66]" />
          )}

          <ChevronDown
            size={13}
            className={cn(
              "text-[#AAA] transition-transform duration-200 shrink-0",
              dropdownOpen && "rotate-180"
            )}
          />
        </button>

        <AnimatePresence>
          {dropdownOpen && (
            <WalletDropdown
              publicKey={publicKey}
              balance={balance}
              network={network}
              isLoadingBalance={isLoadingBalance}
              onRefreshBalance={refreshBalance}
              onDisconnect={disconnect}
              onClose={() => setDropdownOpen(false)}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <span className="text-xs text-red-500 max-w-[160px] truncate">{error}</span>
        <button
          onClick={() => { clearError(); connect(); }}
          className="text-xs font-semibold text-[#0F0F14] underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Default: connect button ────────────────────────────────────────────────

  return (
    <button
      onClick={connect}
      disabled={isConnecting}
      className={cn(
        "inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200",
        "bg-[#B9FF66] text-[#0F0F14] hover:shadow-[0_4px_16px_-4px_rgba(185,255,102,0.6)] active:scale-95",
        "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100",
        className
      )}
    >
      {isConnecting ? (
        <>
          <Spinner size={15} className="text-[#0F0F14]" />
          Connecting…
        </>
      ) : (
        <>
          <Wallet size={15} />
          Connect Wallet
        </>
      )}
    </button>
  );
}
