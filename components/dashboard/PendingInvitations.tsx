"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, Inbox, Map, ReceiptText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useWallet } from "@/hooks/useWallet";
import { requireAuthenticatedClient } from "@/lib/supabase/session";
import { formatAddress } from "@/lib/utils";

type PendingInvitation = {
  entity_type: "expense" | "trip";
  entity_id: string;
  title: string;
  created_by_wallet: string;
  created_at: string;
};

export function PendingInvitations() {
  const { publicKey } = useWallet();
  const { success: toastSuccess, error: toastError } = useToast();
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const loadSequence = useRef(0);

  const loadInvitations = useCallback(async () => {
    const requestSequence = ++loadSequence.current;
    if (!publicKey) {
      setInvitations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const client = await requireAuthenticatedClient(publicKey);
      const { data, error } = await client.rpc("get_pending_invitations");
      if (error) throw error;
      if (requestSequence !== loadSequence.current) return;
      setInvitations((data ?? []) as PendingInvitation[]);
    } catch {
      if (requestSequence !== loadSequence.current) return;
      setLoadError("Invitations could not be loaded. Your balances remain unchanged.");
    } finally {
      if (requestSequence === loadSequence.current) setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    void loadInvitations();
    return () => {
      loadSequence.current += 1;
    };
  }, [loadInvitations]);

  const acceptInvitation = async (invitation: PendingInvitation) => {
    if (!publicKey || acceptingId) return;
    setAcceptingId(invitation.entity_id);
    try {
      const client = await requireAuthenticatedClient(publicKey);
      const { error } = await client.rpc("accept_invitation", {
        p_entity_type: invitation.entity_type,
        p_entity_id: invitation.entity_id,
      });
      if (error) throw error;

      setInvitations((current) =>
        current.filter((item) => item.entity_id !== invitation.entity_id),
      );
      window.dispatchEvent(new Event("settlex:consent-changed"));
      toastSuccess(
        invitation.entity_type === "expense" ? "Expense accepted" : "Trip accepted",
        "The accepted item is now included in your SettleX balances.",
      );
    } catch {
      toastError(
        "Could not accept invitation",
        "Nothing changed. Please retry after checking your connection.",
      );
    } finally {
      setAcceptingId(null);
    }
  };

  if (!loading && !loadError && invitations.length === 0) return null;

  return (
    <section
      className="mb-6 overflow-hidden rounded-2xl border border-[#E5E5E5] bg-white"
      aria-labelledby="pending-invitations-title"
    >
      <div className="flex items-center justify-between border-b border-[#F0F0F0] px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#B9FF66]/20">
            <Inbox size={15} className="text-[#2D6600]" aria-hidden="true" />
          </div>
          <div>
            <h2 id="pending-invitations-title" className="text-sm font-bold text-[#0F0F14]">
              Pending invitations
            </h2>
            <p className="text-[11px] text-[#888]">
              Nothing affects your balances until you accept.
            </p>
          </div>
        </div>
        {!loading && invitations.length > 0 && (
          <span className="rounded-full bg-[#0F0F14] px-2.5 py-1 text-[11px] font-bold text-white">
            {invitations.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3 p-5" aria-label="Loading invitations">
          {[0, 1].map((item) => (
            <div key={item} className="h-16 animate-pulse rounded-xl bg-[#F6F6F6]" />
          ))}
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p role="alert" className="text-sm text-[#666]">{loadError}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => void loadInvitations()}>
            Retry
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-[#F0F0F0]">
          {invitations.map((invitation) => {
            const Icon = invitation.entity_type === "expense" ? ReceiptText : Map;
            const isAccepting = acceptingId === invitation.entity_id;
            const createdDate = new Date(invitation.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            return (
              <li
                key={invitation.entity_type + ":" + invitation.entity_id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0F0F14]">
                    <Icon size={14} className="text-[#B9FF66]" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#0F0F14]">
                      {invitation.title}
                    </p>
                    <p className="mt-0.5 text-xs text-[#666]">
                      From{" "}
                      <span className="font-mono text-[#0F0F14]">
                        {formatAddress(invitation.created_by_wallet, 5)}
                      </span>
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-[#999]">
                      <CalendarDays size={11} aria-hidden="true" />
                      {createdDate}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  loading={isAccepting}
                  disabled={acceptingId !== null}
                  aria-busy={isAccepting}
                  onClick={() => void acceptInvitation(invitation)}
                >
                  Accept
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
