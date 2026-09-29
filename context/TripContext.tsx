"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Trip } from "@/types/trip";
import { getWalletScopedKey, LS_TRIPS } from "@/lib/utils/constants";
import {
  getAuthenticatedClient,
  onSessionChange,
  readStoredSession,
  requireAuthenticatedClient,
} from "@/lib/supabase/session";
import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from "@supabase/supabase-js";
import { useWalletContext } from "./WalletContext";
import { parseTripRow } from "@/lib/supabase/rowGuards";


/**
 * True only when this browser holds an unexpired session token minted for this
 * exact wallet — i.e. the wallet has signed a server challenge at some point.
 *
 * The offline cache is readable by anyone at this keyboard, so possession of an
 * address alone must not unlock it: otherwise a wallet that connects and never
 * signs (or declines to) would be shown the rows of whichever account cached
 * them. Proof of ownership gates the read; the token still authorizes nothing
 * on its own, because the server re-verifies it on every request.
 */
function hasProvenOwnership(walletAddress: string | null): boolean {
  if (!walletAddress) return false;
  try {
    return !!readStoredSession(walletAddress);
  } catch {
    return false;
  }
}


interface TripContextType {
  trips: Trip[];
  addTrip: (trip: Trip) => Promise<void>;
  updateTrip: (id: string, updates: Partial<Trip>) => Promise<void>;
  deleteTrip: (id: string) => Promise<void>;
  addExpenseToTrip: (tripId: string, expenseId: string) => Promise<void>;
  settleTrip: (id: string) => Promise<void>;
  getTrip: (id: string) => Trip | undefined;
  isLoading: boolean;
}


const TripContext = createContext<TripContextType | null>(null);
TripContext.displayName = "TripContext";

function isRowForWallet(row: any, walletAddress: string | null): boolean {
  if (!walletAddress) return false;

  const memberWallets = new Set<string>();
  const rowMembers = Array.isArray(row?.members) ? row.members : [];
  const rowMemberWallets = Array.isArray(row?.member_wallets) ? row.member_wallets : [];

  for (const member of rowMembers) {
    if (member?.walletAddress) memberWallets.add(member.walletAddress);
  }

  for (const wallet of rowMemberWallets) {
    if (wallet) memberWallets.add(wallet);
  }

  if (row?.created_by_wallet) memberWallets.add(row.created_by_wallet);

  return memberWallets.has(walletAddress);
}

function dbRowToTrip(row: unknown): Trip {
  return parseTripRow(row);
}

function tripToDbInsertRow(trip: Trip, creatorWallet: string) {
  const memberWallets = trip.members
    .map((m) => m.walletAddress)
    .filter((addr): addr is string => !!addr);

  const allMemberWallets = creatorWallet && !memberWallets.includes(creatorWallet)
    ? [creatorWallet, ...memberWallets]
    : memberWallets;

  return {
    id: trip.id,
    name: trip.name,
    description: trip.description ?? null,
    members: trip.members,
    expense_ids: trip.expenseIds,
    created_at: trip.createdAt,
    settled: trip.settled,
    created_by_wallet: creatorWallet,
    member_wallets: allMemberWallets,
  };
}


export function TripProvider({ children }: { children: React.ReactNode }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const { publicKey, reconcile } = useWalletContext();

  // Every call is scoped by a JWT the server issues only after the wallet has
  // signed a challenge, so RLS has a wallet identity it can actually trust.
  const getClient = useCallback(async () => {
    if (!publicKey) throw new Error("Wallet not connected");
    await reconcile();
    return requireAuthenticatedClient(publicKey);
  }, [publicKey, reconcile]);

  // Rebind whenever the session is established or dropped, so a re-signed
  // session never leaves this provider holding a client with a stale token.
  const [sessionGeneration, setSessionGeneration] = useState(0);
  useEffect(() => onSessionChange(() => setSessionGeneration((n) => n + 1)), []);

  // Resolve the authenticated client once per wallet so the initial load and
  // the realtime feed share it. Concurrent callers reuse a single handshake,
  // so the wallet is only ever asked to sign once.
  useEffect(() => {
    let cancelled = false;

    if (!publicKey) {
      setClient(null);
      return;
    }

    getAuthenticatedClient(publicKey)
      .then((resolved) => {
        if (!cancelled) setClient(resolved);
      })
      .catch((err) => {
        if (cancelled) return;
        logWarn("trip.signin_failed_using_cache", {
          fields: { ...supabaseErrorFields(err), error: err instanceof Error ? err.message : String(err) },
        });
        setClient(null);
      });

    return () => {
      cancelled = true;
    };
  }, [publicKey, sessionGeneration]);

  useEffect(() => {
    let isMounted = true;

    const cacheKey = publicKey ? getWalletScopedKey(LS_TRIPS, publicKey) : LS_TRIPS;

    async function loadTrips() {
      // Without a proven wallet identity RLS returns nothing, so fall back to
      // whatever this browser cached rather than showing an empty list.
      if (!client) {
        // No proven ownership means no cached rows — not even this wallet's own
        // key, which a previous holder of this browser may have populated.
        if (!hasProvenOwnership(publicKey)) {
          if (isMounted) {
            setTrips([]);
            setIsLoading(false);
          }
          return;
        }
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw && isMounted) setTrips(JSON.parse(raw) as Trip[]);
        } catch {
          // ignore
        }
        if (isMounted) setIsLoading(false);
        return;
      }

      try {
        const { data, error } = await client
          .from("trips")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (isMounted && data) {
          const trips = data.map(dbRowToTrip);
          setTrips(trips);
          localStorage.setItem(cacheKey, JSON.stringify(trips));
        }
      } catch (err) {
        logWarn("trip.load_failed_using_cache", { fields: supabaseErrorFields(err) });
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw && isMounted) {
            setTrips(JSON.parse(raw) as Trip[]);
          }
        } catch {
          // ignore
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadTrips();

    return () => {
      isMounted = false;
    };
  }, [client, publicKey]);


  // Realtime authorizes on the socket's own JWT, so the feed has to run on the
  // authenticated client too — the anon client would receive nothing.
  useEffect(() => {
    if (!client || !publicKey) return;

    const cacheKey = getWalletScopedKey(LS_TRIPS, publicKey);

    const channel = client
      .channel("trips-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "trips" },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const row = payload.new;
          if (!row || !isRowForWallet(row, publicKey)) return;
          const newTrip = dbRowToTrip(row);
          setTrips((prev) => {
            if (prev.some((t) => t.id === newTrip.id)) return prev;
            const updated = [newTrip, ...prev];
            localStorage.setItem(cacheKey, JSON.stringify(updated));
            return updated;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "trips" },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const row = payload.new;
          if (!row || !isRowForWallet(row, publicKey)) return;
          const updatedTrip = dbRowToTrip(row);
          setTrips((prev) => {
            const updated = prev.map((t) =>
              t.id === updatedTrip.id ? updatedTrip : t
            );
            localStorage.setItem(cacheKey, JSON.stringify(updated));
            return updated;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "trips" },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const row = payload.old;
          if (!row || !isRowForWallet(row, publicKey)) return;
          const deletedId = row?.id;
          if (!deletedId) return;
          setTrips((prev) => {
            const updated = prev.filter((t) => t.id !== deletedId);
            localStorage.setItem(cacheKey, JSON.stringify(updated));
            return updated;
          });
        }
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          reportError("trip.realtime_failed", err, { fields: { status } });
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [client, publicKey]);

  const addTrip = useCallback(async (trip: Trip) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const cacheKey = getWalletScopedKey(LS_TRIPS, publicKey);

    setTrips((prev) => {
      const updated = [trip, ...prev];
      localStorage.setItem(cacheKey, JSON.stringify(updated));
      return updated;
    });

    // Persist to Supabase — throw on failure so the caller can handle it
    const client = await getClient();
    const { error } = await client
      .from("trips")
      .insert([tripToDbInsertRow(trip, publicKey)]);

    if (error) {
      setTrips((prev) => {
        const rolled = prev.filter((t) => t.id !== trip.id);
        localStorage.setItem(cacheKey, JSON.stringify(rolled));
        return rolled;
      });
      throw error;
    }
  }, [getClient, publicKey]);

  const updateTrip = useCallback(
    async (id: string, updates: Partial<Trip>) => {
      const current = trips.find((t) => t.id === id);
      if (!current) return;

      const cacheKey = publicKey ? getWalletScopedKey(LS_TRIPS, publicKey) : LS_TRIPS;
      const merged = { ...current, ...updates };

      // Optimistic update
      setTrips((prev) => {
        const updated = prev.map((t) => (t.id === id ? merged : t));
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();

        // Build partial update payload containing only mutable fields.
        // Never send created_by_wallet, created_at, or id in an UPDATE.
        const dbUpdates: Record<string, any> = {};
        if (updates.name !== undefined) dbUpdates.name = updates.name;
        if (updates.description !== undefined) dbUpdates.description = updates.description ?? null;
        if (updates.members !== undefined) {
          dbUpdates.members = updates.members;
          const memberWallets = updates.members
            .map((m) => m.walletAddress)
            .filter((addr): addr is string => !!addr);
          dbUpdates.member_wallets = memberWallets;
        }
        if (updates.expenseIds !== undefined) dbUpdates.expense_ids = updates.expenseIds;
        if (updates.settled !== undefined) dbUpdates.settled = updates.settled;

        const { error } = await client
          .from("trips")
          .update(dbUpdates)
          .eq("id", id);

        if (error) throw error;
      } catch (err) {
        reportError("trip.update_failed", err, {
          fields: { tripId: id, ...supabaseErrorFields(err) },
        });
        // Roll back optimistic update on error
        setTrips((prev) => {
          const rolled = prev.map((t) => (t.id === id ? current : t));
          localStorage.setItem(cacheKey, JSON.stringify(rolled));
          return rolled;
        });
        throw err;
      }
    },
    [trips, getClient, publicKey]
  );

  const deleteTrip = useCallback(
    async (id: string) => {
      const current = trips.find((t) => t.id === id);
      if (!current) return;

      const cacheKey = publicKey ? getWalletScopedKey(LS_TRIPS, publicKey) : LS_TRIPS;

      // Optimistic deletion
      setTrips((prev) => {
        const updated = prev.filter((t) => t.id !== id);
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();
        const { error } = await client.from("trips").delete().eq("id", id);

        if (error) throw error;
      } catch (err) {
        reportError("trip.delete_failed", err, {
          fields: { tripId: id, ...supabaseErrorFields(err) },
        });
        // Roll back optimistic deletion on error
        setTrips((prev) => {
          if (prev.some((t) => t.id === id)) return prev;
          const rolled = [current, ...prev];
          localStorage.setItem(cacheKey, JSON.stringify(rolled));
          return rolled;
        });
        throw err;
      }
    },
    [trips, getClient]
  );

  const addExpenseToTrip = useCallback(
    async (tripId: string, expenseId: string) => {
      const current = trips.find((t) => t.id === tripId);
      if (!current || current.expenseIds.includes(expenseId)) return;

      const cacheKey = publicKey ? getWalletScopedKey(LS_TRIPS, publicKey) : LS_TRIPS;
      const expenseIds = [...current.expenseIds, expenseId];

      // Optimistic update
      setTrips((prev) => {
        const updated = prev.map((t) =>
          t.id === tripId ? { ...t, expenseIds } : t
        );
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();
        const { error } = await client
          .from("trips")
          .update({ expense_ids: expenseIds })
          .eq("id", tripId);

        if (error) throw error;
      } catch (err) {
        reportError("trip.add_expense_failed", err, {
          fields: { tripId, ...supabaseErrorFields(err) },
        });
        // Roll back optimistic update on error
        setTrips((prev) => {
          const rolled = prev.map((t) => (t.id === tripId ? current : t));
          localStorage.setItem(cacheKey, JSON.stringify(rolled));
          return rolled;
        });
        throw err;
      }
    },
    [trips, getClient]
  );

  const settleTrip = useCallback(
    async (id: string) => {
      const current = trips.find((t) => t.id === id);
      if (!current || current.settled) return;

      const cacheKey = publicKey ? getWalletScopedKey(LS_TRIPS, publicKey) : LS_TRIPS;

      // Optimistic update
      setTrips((prev) => {
        const updated = prev.map((t) => (t.id === id ? { ...t, settled: true } : t));
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();
        const { error } = await client
          .from("trips")
          .update({ settled: true })
          .eq("id", id);

        if (error) throw error;
      } catch (err) {
        reportError("trip.settle_failed", err, {
          fields: { tripId: id, ...supabaseErrorFields(err) },
        });
        // Roll back optimistic update on error
        setTrips((prev) => {
          const rolled = prev.map((t) => (t.id === id ? current : t));
          localStorage.setItem(cacheKey, JSON.stringify(rolled));
          return rolled;
        });
        throw err;
      }
    },
    [trips, getClient]
  );

  const getTrip = useCallback(
    (id: string) => trips.find((t) => t.id === id),
    [trips]
  );

  return (
    <TripContext.Provider
      value={{
        trips,
        addTrip,
        updateTrip,
        deleteTrip,
        addExpenseToTrip,
        settleTrip,
        getTrip,
        isLoading,
      }}
    >
      {children}
    </TripContext.Provider>
  );
}

export function useTripContext(): TripContextType {
  const ctx = useContext(TripContext);
  if (!ctx) throw new Error("useTripContext must be used inside <TripProvider>");
  return ctx;
}
