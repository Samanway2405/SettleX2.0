"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Users, ReceiptText, ChevronRight, Trash2, CheckCheck } from "lucide-react";
import type { Trip } from "@/types/trip";
import { cn, formatXLM } from "@/lib/utils";

interface TripCardProps {
  trip: Trip;
  expenseCount?: number;
  totalXLM?: number | string | bigint;
  currentUserPublicKey?: string | null;
  onDelete: (id: string) => void;
  index?: number;
}

export function TripCard({
  trip,
  expenseCount = 0,
  totalXLM = 0,
  currentUserPublicKey,
  onDelete,
  index = 0,
}: TripCardProps) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const isOwner =
    !!currentUserPublicKey && trip.createdByWallet === currentUserPublicKey;

  React.useEffect(() => {
    if (!isOwner) setConfirmDelete(false);
  }, [isOwner]);

  const createdAt = new Date(trip.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: index * 0.04 }}
      className={cn(
        "bg-white rounded-2xl border overflow-hidden transition-all hover:shadow-sm",
        trip.settled ? "border-[#B9FF66]/40" : "border-[#E5E5E5] hover:border-[#D0D0D0]"
      )}
    >
      <Link href={`/trips/${trip.id}`} className="block p-4">
        <div className="flex items-start justify-between gap-3">
          {/* Icon + info */}
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#0F0F14] flex items-center justify-center shrink-0">
              <span className="text-[#B9FF66] text-base">✈</span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-bold text-[#0F0F14] truncate">{trip.name}</p>
                {trip.settled && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 bg-[#B9FF66]/30 text-[#2D6600] rounded-full">
                    <CheckCheck size={9} />
                    Settled
                  </span>
                )}
              </div>
              {trip.description && (
                <p className="text-xs text-[#888] truncate mb-1.5">{trip.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#AAA]">
                <span className="flex items-center gap-1">
                  <Users size={10} />
                  {trip.members.length} members
                </span>
                <span className="flex items-center gap-1">
                  <ReceiptText size={10} />
                  {expenseCount} expense{expenseCount !== 1 ? "s" : ""}
                </span>
                {Boolean(totalXLM) && (
                  <span className="font-semibold text-[#555]">
                    {formatXLM(totalXLM)} XLM
                  </span>
                )}
              </div>
            </div>
          </div>

          <ChevronRight size={14} className="text-[#CCC] shrink-0 mt-1" />
        </div>
      </Link>

      {/* Footer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-t border-[#F5F5F5]">
        <span className="text-[10px] text-[#BBB]">{createdAt}</span>
        {isOwner && (
          confirmDelete ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200">
              <p className="text-xs text-red-600 font-medium break-words">
                Delete &ldquo;{trip.name}&rdquo;? This cannot be undone.
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(false); }}
                  className="text-xs font-semibold text-[#888] hover:text-[#0F0F14] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(trip.id); }}
                  className="inline-flex items-center gap-1 text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1 rounded-lg transition-colors"
                >
                  <Trash2 size={11} />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmDelete(true); }}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-[#CCC] hover:text-red-500 hover:bg-red-50 transition-colors"
            >
              <Trash2 size={11} />
              Delete
            </button>
          )
        )}
      </div>
    </motion.div>
  );
}
