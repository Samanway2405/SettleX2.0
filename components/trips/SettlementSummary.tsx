"use client";

import React, { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, ArrowRight, Scale, CheckCircle2, Database } from "lucide-react";
import type { Expense } from "@/types/expense";
import type { Trip } from "@/types/trip";
import type { ContractPaymentEvent } from "@/types/contract";
import type { NetPayment, RawDebt } from "@/lib/settlement/netBalance";
import { computeNetPayments } from "@/lib/settlement/netBalance";
import { buildPaymentTransaction } from "@/lib/stellar/buildTransaction";
import { submitSignedTransaction } from "@/lib/stellar/submitTransaction";
import { signXDR } from "@/lib/freighter";
import { useWallet } from "@/hooks/useWallet";
import { useExpense } from "@/hooks/useExpense";
import { useToast } from "@/components/ui/Toast";
import { NETWORK_PASSPHRASE } from "@/lib/utils/constants";
import { PayButton } from "@/components/payment/PayButton";
import { TransactionHash } from "@/components/payment/TransactionHash";
import { cn, formatXLM } from "@/lib/utils";
import { userFacingMessage } from "@/lib/errors/userMessage";
import { selectCoveredShares } from "@/lib/settlement/shareBudget";

interface SettlementSummaryProps {
  trip: Trip;
  expenses: Expense[];
  onChainEvents?: ContractPaymentEvent[];
}

type RowState =
  | { status: "idle" }
  | { status: "paying" }
  | { status: "done"; txHash: string };

function deriveRawDebts(expenses: Expense[], onChainEvents: ContractPaymentEvent[] = []): RawDebt[] {
  const attestedOnChainSet = new Set(
    onChainEvents
      .filter((e) => e.attested === true)
      .map((e) => `${e.expenseId}-${e.member.toLowerCase()}`),
  );
  
  const debts: RawDebt[] = [];
  for (const expense of expenses) {
    for (const share of expense.shares) {
      const payer = expense.members.find((m) => m.id === expense.paidByMemberId);
      if (!payer || share.memberId === expense.paidByMemberId) continue;
      
      const isPaidOnChain =
        share.walletAddress &&
        attestedOnChainSet.has(`${expense.id}-${share.walletAddress.toLowerCase()}`);
      if (share.paid || isPaidOnChain) continue;
      
      debts.push({
        from:       share.name,
        fromId:     share.memberId,
        to:         payer.name,
        amount:     share.amount,
        fromWallet: share.walletAddress,
        toWallet:   payer.walletAddress,
      });
    }
  }
  return debts;
}

function deriveUnverifiedClaims(
  expenses: Expense[],
  onChainEvents: ContractPaymentEvent[] = [],
): Map<string, number> {
  const unverifiedOnChainSet = new Set(
    onChainEvents
      .filter((e) => e.attested !== true)
      .map((e) => `${e.expenseId}-${e.member.toLowerCase()}`),
  );

  const claims = new Map<string, number>();
  for (const expense of expenses) {
    const payer = expense.members.find((m) => m.id === expense.paidByMemberId);
    if (!payer?.walletAddress) continue;

    for (const share of expense.shares) {
      if (share.paid || share.memberId === expense.paidByMemberId || !share.walletAddress) continue;
      if (!unverifiedOnChainSet.has(`${expense.id}-${share.walletAddress.toLowerCase()}`)) continue;

      const key = `${share.walletAddress.toLowerCase()}-${payer.walletAddress.toLowerCase()}`;
      claims.set(key, (claims.get(key) ?? 0) + 1);
    }
  }

  return claims;
}

function NetPaymentRow({
  payment,
  index,
  tripName,
  expenses,
  unverifiedClaimCount,
}: {
  payment: NetPayment;
  index: number;
  tripName: string;
  expenses: Expense[];
  unverifiedClaimCount?: number;
}) {
  const { publicKey } = useWallet();
  const { markSharePaid } = useExpense();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();
  const [rowState, setRowState] = useState<RowState>({ status: "idle" });

  const canPay =
    publicKey &&
    payment.toWallet &&
    rowState.status === "idle" &&
    publicKey === payment.fromWallet;

  const handlePay = async () => {
    if (!publicKey || !payment.toWallet) return;
    try {
      setRowState({ status: "paying" });
      const coveredShares = selectCoveredShares(payment, expenses);
      const memo = `SettleX|${tripName}`.slice(0, 28);
      const { xdr } = await buildPaymentTransaction({
        sourcePublicKey:      publicKey,
        destinationPublicKey: payment.toWallet,
        amount:               payment.amount,
        memoText:             memo,
      });
      toastInfo("Waiting for Freighter?", "Confirm the settlement payment.");
      const signedXDR = await signXDR(xdr, NETWORK_PASSPHRASE);
      const { hash }  = await submitSignedTransaction(signedXDR);

      // Only close shares up to the net amount actually transferred.
      // A netted payment may be smaller than the gross obligations it represents
      // (e.g. A owes B 10 XLM and B owes A 4 XLM → net 6 XLM transfer). Marking
      // ALL of A's shares paid would write off 10 XLM while only 6 XLM moved.
      for (const share of coveredShares) {
        try {
          await markSharePaid(share.expenseId, share.memberId, hash);
        } catch {
          // The Stellar transfer succeeded; local reconciliation can retry.
        }
      }

      setRowState({ status: "done", txHash: hash });
      toastSuccess(
        "Settlement sent!",
        `Paid ${formatXLM(payment.amount)} XLM to ${payment.to}`,
      );
    } catch (err: unknown) {
      const msg        = err instanceof Error ? err.message : "Payment failed";
      const isRejected = /reject|denied|cancel/i.test(msg);
      toastError(
        isRejected ? "Transaction cancelled" : "Payment failed",
        // Vetted before display: a settlement failure can surface a raw PostgREST
        // or RPC message, which must not be shown to the user verbatim.
        isRejected
          ? "You rejected the payment in Freighter."
          : userFacingMessage(err).message,
      );
      setRowState({ status: "idle" });
    }
  };

  const done = rowState.status === "done";

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      className={cn(
        "flex flex-col gap-2 p-3.5 rounded-xl border transition-all",
        done ? "bg-[#F0FFDB] border-[#B9FF66]/40" : "bg-white border-[#E5E5E5]",
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 min-w-0 text-sm font-semibold text-[#0F0F14]">
          <span className="truncate">{payment.from}</span>
          <ArrowRight size={13} className="text-[#B9FF66] shrink-0" />
          <span className="truncate">{payment.to}</span>
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2">
          <span className="text-sm font-bold">
            {formatXLM(payment.amount)}{" "}
            <span className="text-[10px] font-normal text-[#888]">XLM</span>
          </span>

          {done ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 bg-[#B9FF66]/30 text-[#2D6600] rounded-full">
              <CheckCircle2 size={9} /> Paid
            </span>
          ) : (
            <PayButton
              amount={payment.amount}
              recipientName={payment.to}
              onClick={handlePay}
              isLoading={rowState.status === "paying"}
              disabled={!canPay}
              size="sm"
            />
          )}
        </div>
      </div>

      {done && (
        <div className="pl-1">
          <TransactionHash hash={rowState.txHash} compact />
        </div>
      )}

      {!done && !!unverifiedClaimCount && (
        <p className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#8A5A00] pl-1">
          <AlertCircle size={11} className="shrink-0" />
          {payment.from} reports paid - unverified
        </p>
      )}

      {!done && rowState.status === "idle" && publicKey && publicKey !== payment.fromWallet && (
        <p className="text-[10px] text-[#AAA] pl-1">
          Connect {payment.from}&apos;s wallet to pay
        </p>
      )}
    </motion.div>
  );
}

export function SettlementSummary({ trip, expenses, onChainEvents = [] }: SettlementSummaryProps) {
  const rawDebts         = useMemo(() => deriveRawDebts(expenses, onChainEvents), [expenses, onChainEvents]);
  const unverifiedClaims = useMemo(() => deriveUnverifiedClaims(expenses, onChainEvents), [expenses, onChainEvents]);
  const netPayments      = useMemo(() => computeNetPayments(rawDebts), [rawDebts]);

  if (netPayments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center rounded-xl border border-dashed border-[#D0D0D0]">
        <Scale size={20} className="text-[#B9FF66]" />
        <p className="text-sm font-semibold text-[#0F0F14]">All settled up!</p>
        <p className="text-xs text-[#AAA]">No outstanding balances in this trip.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Scale size={14} className="text-[#B9FF66]" />
          <h3 className="text-sm font-bold text-[#0F0F14]">
            Settlement ({netPayments.length} payment{netPayments.length !== 1 ? "s" : ""})
          </h3>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {eventCounts.attested > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#2D6600] bg-[#B9FF66]/20 px-2 py-0.5 rounded-full">
              <Database size={9} />
              {eventCounts.attested} verified on-chain
            </span>
          )}
          {eventCounts.selfReported > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#8A5A00] bg-[#FFF2CC] px-2 py-0.5 rounded-full">
              <AlertCircle size={9} />
              {eventCounts.selfReported} self-reported
            </span>
          )}
        </div>
      </div>

      {netPayments.map((p, i) => (
        <NetPaymentRow
          key={`${p.fromId}-${p.toId}-${i}`}
          payment={p}
          index={i}
          tripName={trip.name}
          expenses={expenses}
          unverifiedClaimCount={
            p.fromWallet && p.toWallet
              ? unverifiedClaims.get(`${p.fromWallet.toLowerCase()}-${p.toWallet.toLowerCase()}`)
              : undefined
          }
        />
      ))}
    </div>
  );
}
