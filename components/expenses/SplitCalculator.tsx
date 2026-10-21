"use client";

import React from "react";
import { Users, Calculator } from "lucide-react";
import { formatXLM } from "@/lib/utils";
import { xlmToStroops, stroopsToXlm } from "@/lib/split/calculator";
import { PaymentRow } from "./PaymentRow";
import type { SplitShare } from "@/types/expense";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SplitCalculatorProps {
  shares: SplitShare[];
  payerName: string;
  totalAmount: string;
  expenseTitle?: string;
  /** Called when user clicks Pay on a row. */
  onPay?: (share: SplitShare) => void;
  /** ID of the share whose payment is currently in-flight (shows spinner). */
  payingShareId?: string;
  /** Disable pay buttons */
  disablePay?: boolean;
  /** Connected wallet address — Pay button only shows on the matching row. */
  connectedWalletAddress?: string | null;
  /** Payer’s wallet address — never show Pay button for the payer, even if wallets overlap. */
  payerWalletAddress?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SplitCalculator({
  shares,
  payerName,
  totalAmount,
  expenseTitle = "Expense",
  onPay,
  payingShareId,
  disablePay = false,
  connectedWalletAddress,
  payerWalletAddress,
}: SplitCalculatorProps) {
  const totalStroops = (() => {
    try { return xlmToStroops(totalAmount || "0"); } catch { return 0n; }
  })();
  const splitTotalStroops = shares.reduce((s, x) => {
    try { return s + xlmToStroops(x.amount || "0"); } catch { return s; }
  }, 0n);
  const paidCount = shares.filter((s) => s.paid).length;

  if (shares.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E5E5] p-6 text-center">
        <Users size={20} className="text-[#CCC] mx-auto mb-2" />
        <p className="text-sm text-[#AAA]">
          Add at least 2 members to see the split.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 bg-[#F8F8F8] rounded-xl border border-[#E5E5E5]">
        <div className="flex items-start sm:items-center gap-2 text-sm text-[#555] min-w-0">
          <Calculator size={14} />
          <span className="leading-relaxed">
            <strong className="text-[#0F0F14]">{payerName}</strong> paid{" "}
            <strong className="text-[#0F0F14]">
              {formatXLM(totalAmount)} XLM
            </strong>
          </span>
        </div>
        {paidCount > 0 && (
          <span className="text-xs font-semibold text-[#2D6600]">
            {paidCount}/{shares.length} paid
          </span>
        )}
      </div>

      {/* Progress bar */}
      {paidCount > 0 && (
        <div className="h-1 w-full bg-[#F0F0F0] rounded-full overflow-hidden">
          <div
            className="h-full bg-[#B9FF66] rounded-full transition-all duration-500"
            style={{ width: `${(paidCount / shares.length) * 100}%` }}
          />
        </div>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {shares.map((share, i) => (
          <PaymentRow
            key={share.memberId}
            share={share}
            index={i}
            expenseTitle={expenseTitle}
            onPay={disablePay ? undefined : onPay}
            isPaying={payingShareId === share.memberId}
            connectedWalletAddress={connectedWalletAddress}
            payerWalletAddress={payerWalletAddress}
          />
        ))}
      </div>

      {/* Split total vs actual total */}
      <div className="flex items-center justify-between text-xs text-[#AAA] px-1">
        <span>Split total</span>
        <span
          className={
            splitTotalStroops <= totalStroops ? "text-[#2D6600]" : "text-orange-500"
          }
        >
          {formatXLM(stroopsToXlm(splitTotalStroops))} XLM
        </span>
      </div>
    </div>
  );
}
