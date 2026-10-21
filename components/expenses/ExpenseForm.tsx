"use client";

import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Zap, Users, ChevronDown } from "lucide-react";
import { Input, Textarea } from "@/components/ui/Input";
import { SplitCalculator } from "./SplitCalculator";
import {
  calculateSplit,
  isValidXLMAmount,
  isValidStellarAddress,
  isValidSplitWeight,
  MIN_SPLIT_WEIGHT,
  MAX_SPLIT_WEIGHT,
  stroopsToXlm,
  xlmToStroops,
} from "@/lib/split/calculator";
import { useExpense } from "@/hooks/useExpense";
import { useToast } from "@/components/ui/Toast";
import { AuthContext } from "@/context/AuthContext";
import type { Expense, ExpenseFormData, Member, SplitMode } from "@/types/expense";

const MAX_MEMBERS = 50;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankMember(): Member {
  return { id: crypto.randomUUID(), name: "", walletAddress: "", weight: 1 };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpenseFormProps {
  /** Called after a successful submit — receives the new expense ID */
  onSuccess?: (expenseId?: string) => void;
  onCancel?: () => void;
  /** Prefill the payer's wallet address from connected wallet */
  currentUserPublicKey?: string | null;
  /** Prefill the payer's name from authenticated user */
  currentUserName?: string | null;
  /** Pre-populate members (used when creating expense within a trip) */
  defaultMembers?: Member[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ExpenseForm({
  onSuccess,
  onCancel,
  currentUserPublicKey,
  currentUserName,
  defaultMembers,
}: ExpenseFormProps) {
  const { addExpense } = useExpense();
  const { success: toastSuccess, error: toastError } = useToast();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [splitMode, setSplitMode]     = useState<SplitMode>("equal");
  const [members, setMembers]         = useState<Member[]>(() => {
    if (defaultMembers && defaultMembers.length >= 2) return defaultMembers;
    return [
      {
        id: crypto.randomUUID(),
        name: currentUserName ?? "",               // pre-fill from authenticated user
        walletAddress: currentUserPublicKey ?? "", // pre-fill from connected wallet
        weight: 1,
      },
      blankMember(),
    ];
  });
  const [paidByMemberId, setPaidBy]   = useState(members[0].id);
  const [submitting, setSubmitting]   = useState(false);

  // ── Field-level errors ──────────────────────────────────────────────────────
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── User profile resolution ─────────────────────────────────────────────────
  const authContext = useContext(AuthContext);
  const resolveUserProfile = authContext?.resolveUserProfile;
  const [resolvedProfiles, setResolvedProfiles] = useState<Record<string, string>>({});

  // ── Live split preview ──────────────────────────────────────────────────────
  // Preview shows as soon as: valid amount + at least 2 members have names.
  // Wallet addresses are NOT required for the preview — they are only
  // required at submit time so that XLM payments can actually be sent.
  const namedMembers = members.filter((m) => m.name.trim());

  const shares = useMemo(() => {
    if (!totalAmount || !isValidXLMAmount(totalAmount)) return [];
    const named = members.filter((m) => m.name.trim());
    if (named.length < 2) return [];
    try {
      return calculateSplit(totalAmount, named, paidByMemberId, splitMode);
    } catch {
      return [];
    }
  }, [totalAmount, members, paidByMemberId, splitMode]);

  const payerName =
    members.find((m) => m.id === paidByMemberId)?.name || "Payer";

  // Keep paidByMemberId valid if members change
  useEffect(() => {
    if (!members.find((m) => m.id === paidByMemberId)) {
      setPaidBy(members[0]?.id ?? "");
    }
  }, [members, paidByMemberId]);

  // ── Member helpers ──────────────────────────────────────────────────────────
  const addMember = () => {
    if (members.length >= MAX_MEMBERS) return;
    setMembers((prev) => [...prev, blankMember()]);
  };

  const removeMember = (id: string) => {
    if (members.length <= 2) return; // minimum 2 members
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const updateMember = (id: string, patch: Partial<Member>) => {
    setMembers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m))
    );
  };

  const handleMemberAddressChange = useCallback(
    async (id: string, address: string) => {
      updateMember(id, { walletAddress: address });
      const trimmed = address.trim();
      if (!resolveUserProfile || !isValidStellarAddress(trimmed)) return;
      try {
        const verifiedName = await resolveUserProfile(trimmed);
        if (verifiedName) {
          setResolvedProfiles((prev) => ({ ...prev, [trimmed]: verifiedName }));
          setMembers((prev) =>
            prev.map((m) =>
              m.id === id && (!m.name.trim() || m.name.startsWith("Member") || m.name.startsWith("Person"))
                ? { ...m, name: verifiedName }
                : m
            )
          );
        }
      } catch {
        // ignore profile lookup failure
      }
    },
    [resolveUserProfile]
  );

  // ── Validation ──────────────────────────────────────────────────────────────
  function validate(): boolean {
    const errs: Record<string, string> = {};

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      errs.title = "Title is required.";
    } else if (trimmedTitle.length > 120) {
      errs.title = "Title cannot exceed 120 characters.";
    }

    if (description.trim().length > 100) {
      errs.description = "Description cannot exceed 100 characters.";
    }

    if (!totalAmount || !isValidXLMAmount(totalAmount))
      errs.totalAmount = "Enter a valid XLM amount (e.g. 10.5).";

    members.forEach((m, i) => {
      const trimmedName = m.name.trim();
      if (!trimmedName) {
        errs[`member_name_${i}`] = "Name is required.";
      } else if (trimmedName.length > 50) {
        errs[`member_name_${i}`] = "Name cannot exceed 50 characters.";
      }
      if (!m.walletAddress?.trim())
        errs[`member_addr_${i}`] = "Stellar address is required to enable payments.";
      else if (!isValidStellarAddress(m.walletAddress.trim()))
        errs[`member_addr_${i}`] = "Invalid Stellar address (must start with G, 56 chars).";

      if (
        splitMode === "custom" &&
        !isValidSplitWeight(m.weight)
      ) {
        errs[`member_weight_${i}`] = `Weight must be a whole number between ${MIN_SPLIT_WEIGHT} and ${MAX_SPLIT_WEIGHT}.`;
      }
    });

    const filledNames = members.filter((m) => m.name.trim());
    if (filledNames.length < 2) {
      errs.members = "Add at least 2 members.";
    } else if (members.length > MAX_MEMBERS) {
      errs.members = "Maximum 50 members allowed.";
    }

    const weightsAreValid = members.every((m) => isValidSplitWeight(m.weight));

    if (
      splitMode === "custom" &&
      isValidXLMAmount(totalAmount) &&
      filledNames.length >= 2 &&
      weightsAreValid
    ) {
      try {
        // An unmatched payer ID makes the calculator return every member's
        // allocation, including the actual payer's share.
        const allocations = calculateSplit(totalAmount, members, "", "custom");
        const allocatedTotal = allocations.reduce(
          (sum, share) => sum + xlmToStroops(share.amount),
          0n
        );

        if (allocatedTotal !== xlmToStroops(totalAmount)) {
          errs.members = "Custom split shares must add up to the total amount.";
        }
      } catch {
        errs.members = "Unable to calculate a valid custom split.";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;

      setSubmitting(true);
      try {
        const cleanMembers = members.map((m) => ({
          ...m,
          walletAddress: m.walletAddress?.trim(),
        }));

        const calculatedShares = calculateSplit(
          totalAmount,
          cleanMembers,
          paidByMemberId,
          splitMode
        );

        const expense: Expense = {
          id: crypto.randomUUID(),
          title: title.trim(),
          description: description.trim() || undefined,
          totalAmount: stroopsToXlm(xlmToStroops(totalAmount)),
          currency: "XLM",
          splitMode,
          paidByMemberId,
          members: cleanMembers,
          shares: calculatedShares,
          createdAt: new Date().toISOString(),
          settled: false,
        };

        await addExpense(expense);
        toastSuccess("Expense created!", `"${expense.title}" split among ${cleanMembers.length} members.`);
        onSuccess?.(expense.id);
      } catch (err: any) {
        const msg = err?.message || "Failed to create expense.";
        if (msg.includes("policy") || msg.includes("permission") || msg.includes("uuid") || msg.includes("syntax")) {
          toastError("Save failed", "Database error. Please check your setup or try again.");
        } else if (msg.includes("fetch") || msg.includes("network") || msg.includes("Network")) {
          toastError("No connection", "Cannot reach server. Check your connection (WARP on?).");
        } else {
          toastError("Error", msg);
        }
      } finally {
        setSubmitting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, description, totalAmount, splitMode, members, paidByMemberId]
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Title */}
      <Input
        label="Expense title"
        required
        placeholder="Dinner at Ramen Soul"
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        error={errors.title}
      />

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-[#444] uppercase tracking-wide">
            Description
          </label>
          <span className={`text-[10px] font-medium tabular-nums ${
            description.length >= 100 ? "text-red-500" : description.length >= 80 ? "text-amber-500" : "text-[#CCC]"
          }`}>
            {description.length}/100
          </span>
        </div>
        <Textarea
          placeholder="Add a short note about this expense…"
          value={description}
          maxLength={100}
          error={errors.description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {/* Amount + split mode row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Total amount"
          required
          placeholder="10.5"
          type="number"
          min="0.0000001"
          step="0.0000001"
          value={totalAmount}
          onChange={(e) => setTotalAmount(e.target.value)}
          error={errors.totalAmount}
          trailing={<span className="text-xs font-semibold">XLM</span>}
        />

        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-[#444] uppercase tracking-wide">
            Split mode
          </label>
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F0F0F0] rounded-xl">
            {(["equal", "custom"] as SplitMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setSplitMode(mode)}
                className={`py-2 rounded-lg text-xs font-bold capitalize transition-all ${
                  splitMode === mode
                    ? "bg-white text-[#0F0F14] shadow-sm"
                    : "text-[#888] hover:text-[#555]"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Members section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-semibold text-[#444] uppercase tracking-wide flex items-center gap-1.5">
            <Users size={12} />
            Members
            <span className="text-[#CCC] font-normal normal-case tracking-normal">
              ({members.length})
            </span>
          </label>
          <button
            type="button"
            onClick={addMember}
            disabled={members.length >= MAX_MEMBERS}
            className={`flex items-center gap-1 text-xs font-semibold transition-colors ${
              members.length >= MAX_MEMBERS
                ? "text-[#CCC] cursor-not-allowed"
                : "text-[#555] hover:text-[#0F0F14]"
            }`}
          >
            <Plus size={13} />
            Add
          </button>
        </div>

        {errors.members && (
          <p className="text-xs text-red-500 mb-2">{errors.members}</p>
        )}

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {members.map((member, i) => (
              <motion.div
                key={member.id}
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: "auto", marginBottom: 0 }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                <div className="flex items-start gap-2 p-3 bg-[#F8F8F8] rounded-xl border border-[#EEEEEE]">
                  <div className="w-7 h-7 rounded-full bg-[#E5E5E5] flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold text-[#888]">
                    {member.name ? member.name.charAt(0).toUpperCase() : "?"}
                  </div>

                  <div className="flex-1 grid grid-cols-1 gap-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <input
                          placeholder="Name *"
                          value={member.name}
                          maxLength={50}
                          onChange={(e) => updateMember(member.id, { name: e.target.value })}
                          className={`w-full rounded-lg border px-3 py-2 text-sm bg-white outline-none transition-all
                            ${errors[`member_name_${i}`]
                              ? "border-red-300 focus:border-red-400"
                              : "border-[#E5E5E5] focus:border-[#B9FF66] focus:ring-2 focus:ring-[#B9FF66]/20"
                            }`}
                        />
                        {errors[`member_name_${i}`] && (
                          <p className="text-xs text-red-500 mt-1">
                            {errors[`member_name_${i}`]}
                          </p>
                        )}
                      </div>

                      {splitMode === "custom" && (
                        <div>
                          <input
                            type="number"
                            min={MIN_SPLIT_WEIGHT}
                            max={MAX_SPLIT_WEIGHT}
                            step={1}
                            placeholder="Weight"
                            value={member.weight ?? ""}
                            onChange={(e) =>
                              updateMember(member.id, { weight: Number(e.target.value) })
                            }
                            aria-invalid={Boolean(errors[`member_weight_${i}`])}
                            aria-describedby={
                              errors[`member_weight_${i}`]
                                ? `member-weight-error-${member.id}`
                                : undefined
                            }
                            className={`w-full rounded-lg border px-3 py-2 text-sm bg-white outline-none transition-all
                              ${errors[`member_weight_${i}`]
                                ? "border-red-300 focus:border-red-400"
                                : "border-[#E5E5E5] focus:border-[#B9FF66] focus:ring-2 focus:ring-[#B9FF66]/20"
                              }`}
                          />
                          {errors[`member_weight_${i}`] && (
                            <p
                              id={`member-weight-error-${member.id}`}
                              className="text-xs text-red-500 mt-1"
                            >
                              {errors[`member_weight_${i}`]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <input
                      placeholder="Stellar address G… (required to pay)"
                      value={member.walletAddress ?? ""}
                      onChange={(e) => handleMemberAddressChange(member.id, e.target.value)}
                      className={`w-full rounded-lg border px-3 py-2 text-sm bg-white outline-none transition-all font-mono
                        ${errors[`member_addr_${i}`]
                          ? "border-red-300 focus:border-red-400"
                          : "border-[#E5E5E5] focus:border-[#B9FF66] focus:ring-2 focus:ring-[#B9FF66]/20"
                        }`}
                    />
                    {/* Verified user profile resolution indicator */}
                    {(() => {
                      const addr = member.walletAddress?.trim();
                      if (!addr || !isValidStellarAddress(addr)) return null;
                      const verifiedName = resolvedProfiles[addr];
                      if (!verifiedName) return null;
                      if (member.name === verifiedName) {
                        return (
                          <p className="text-[11px] text-emerald-600 font-medium">
                            ✓ Verified profile: {verifiedName}
                          </p>
                        );
                      }
                      return (
                        <div className="flex items-center gap-1.5 text-[11px] text-[#555]">
                          <span>Verified profile: <strong>{verifiedName}</strong></span>
                          <button
                            type="button"
                            onClick={() => updateMember(member.id, { name: verifiedName })}
                            className="text-xs text-blue-600 underline hover:text-blue-800"
                          >
                            Use verified name
                          </button>
                        </div>
                      );
                    })()}
                    {/* Inline duplicate check — shown while user types, before submit */}
                    {(() => {
                      const addr = member.walletAddress?.trim();
                      if (!addr || !isValidStellarAddress(addr)) return null;
                      const dupIndex = members.findIndex(
                        (m2, j) => j !== i && m2.walletAddress?.trim() === addr
                      );
                      if (dupIndex === -1) return null;
                      return (
                        <p className="text-xs text-red-500">
                          Same wallet as {members[dupIndex].name.trim() || `Person ${dupIndex + 1}`} — each member needs a unique address.
                        </p>
                      );
                    })()
                    }
                    {errors[`member_addr_${i}`] ? (
                      <p className="text-xs text-red-500">{errors[`member_addr_${i}`]}</p>
                    ) : (
                      <p className="text-[10px] text-[#AAA]">Stellar wallet address — needed to send XLM payment</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeMember(member.id)}
                    disabled={members.length <= 2}
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[#CCC] hover:text-red-400 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed mt-0.5"
                    title="Remove member"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Payer selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-[#444] uppercase tracking-wide">
          Who paid the bill?
        </label>
        <div className="relative">
          <select
            value={paidByMemberId}
            onChange={(e) => setPaidBy(e.target.value)}
            className="w-full rounded-xl border border-[#E5E5E5] px-3.5 py-2.5 text-sm text-[#0F0F14] bg-white outline-none appearance-none focus:border-[#B9FF66] focus:ring-2 focus:ring-[#B9FF66]/20 transition-all pr-9"
          >
            {members
              .filter((m) => m.name.trim())
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
          <ChevronDown
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#AAA] pointer-events-none"
          />
        </div>
        <p className="text-[10px] text-[#AAA]">
          All members are included in the split. Choose who paid upfront.
        </p>
      </div>

      {/* Live split preview — shows as soon as amount + 2 named members are filled */}
      {shares.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-[#444] uppercase tracking-wide">
              Split preview
            </p>
            {namedMembers.some((m) => !m.walletAddress?.trim()) && (
              <p className="text-[10px] text-amber-500 font-medium">
                Fill wallet addresses to enable payments
              </p>
            )}
          </div>
          <SplitCalculator
            shares={shares}
            payerName={payerName}
            totalAmount={totalAmount}
            disablePay={true}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#F0F0F0]">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-[#555] hover:text-[#0F0F14] hover:bg-[#F0F0F0] transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F0F14] text-[#B9FF66] text-sm font-bold hover:bg-[#1A1A22] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
        >
          <Zap size={14} className="fill-[#B9FF66]" />
          {submitting ? "Saving…" : "Create Expense"}
        </button>
      </div>
    </form>
  );
}
