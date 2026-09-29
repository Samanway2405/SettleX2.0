"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchContractEvents } from "@/lib/stellar/events";
import type { ContractPaymentEvent } from "@/types/contract";
import { CONTRACT_ID } from "@/lib/utils/constants";
import { userFacingMessage } from "@/lib/errors/userMessage";

const POLL_INTERVAL_MS = 10_000;

interface UseContractEventsResult {
  events: ContractPaymentEvent[];
  latestLedger: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useContractEvents(tripId: string | undefined): UseContractEventsResult {
  const [events, setEvents]             = useState<ContractPaymentEvent[]>([]);
  const [latestLedger, setLatestLedger] = useState(0);
  const [isLoading, setIsLoading]       = useState(false);
  const [error, setError]               = useState<string | null>(null);

  const ledgerRef = useRef(0);
  ledgerRef.current = latestLedger;

  const fetch_ = useCallback(async (isFirst = false) => {
    if (!tripId || !CONTRACT_ID) return;
    if (isFirst) setIsLoading(true);

    try {
      const result = await fetchContractEvents(ledgerRef.current, tripId);

      if (result.events.length > 0) {
        setEvents((prev) => {
          const known   = new Set(prev.map((e) => e.txHash));
          const newEvts = result.events.filter((e) => !known.has(e.txHash));
          return newEvts.length > 0 ? [...prev, ...newEvts] : prev;
        });
      }

      if (result.latestLedger > ledgerRef.current) {
        setLatestLedger(result.latestLedger);
      }
      setError(null);
    } catch (err) {
      // Rendered in the trip page's degraded-state banner, so it is vetted: a
      // Soroban RPC failure surfaces transport text, not anything actionable.
      // lib/stellar/events.ts already logs the underlying error.
      setError(userFacingMessage(err).message);
    } finally {
      if (isFirst) setIsLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    if (!tripId || !CONTRACT_ID) return;

    fetch_(true);
    const interval = setInterval(() => fetch_(), POLL_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") fetch_(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tripId, fetch_]);

  return { events, latestLedger, isLoading, error, refresh: () => fetch_() };
}
