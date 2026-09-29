"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Expense, SplitShare } from "@/types/expense";
import { getWalletScopedKey, LS_EXPENSES } from "@/lib/utils/constants";
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
import { logWarn, reportError } from "@/lib/observability/logger";
import { supabaseErrorFields } from "@/lib/observability/supabaseError";


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


interface ExpenseContextType {
  expenses: Expense[];
  addExpense: (expense: Expense) => Promise<void>;
  updateExpense: (id: string, updates: Partial<Expense>) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  markSharePaid: (expenseId: string, memberId: string, txHash: string) => Promise<void>;
  getExpense: (id: string) => Expense | undefined;
  isLoading: boolean;
}


const ExpenseContext = createContext<ExpenseContextType | null>(null);
ExpenseContext.displayName = "ExpenseContext";

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

/**
 * Raised when a write loses to a concurrent one. Distinct from a transport
 * failure: local state already holds the winning row, so the caller should
 * reapply its change rather than retry the same stale payload.
 */
export class ExpenseConflictError extends Error {}

function dbRowToExpense(row: unknown): Expense {
  return parseExpenseRow(row);
}

function expenseToDbInsertRow(expense: Expense, creatorWallet: string) {
  const memberWallets = expense.members
    .map((m) => m.walletAddress)
    .filter((addr): addr is string => !!addr);

  const allMemberWallets =
    creatorWallet && !memberWallets.includes(creatorWallet)
      ? [creatorWallet, ...memberWallets]
      : memberWallets;

  return {
    id: expense.id,
    title: expense.title,
    description: expense.description ?? null,
    total_amount: expense.totalAmount,
    currency: expense.currency,
    split_mode: expense.splitMode,
    paid_by_member_id: expense.paidByMemberId,
    members: expense.members,
    shares: expense.shares,
    created_at: expense.createdAt,
    settled: expense.settled,
    version: expense.version ?? 1,
    created_by_wallet: creatorWallet,
    member_wallets: allMemberWallets,
  };
}


export function ExpenseProvider({ children }: { children: React.ReactNode }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
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
        logWarn("expense.signin_failed_using_cache", {
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

    const cacheKey = publicKey ? getWalletScopedKey(LS_EXPENSES, publicKey) : LS_EXPENSES;

    async function loadExpenses() {
      // Without a proven wallet identity RLS returns nothing, so fall back to
      // whatever this browser cached rather than showing an empty list.
      if (!client) {
        // No proven ownership means no cached rows — not even this wallet's own
        // key, which a previous holder of this browser may have populated.
        if (!hasProvenOwnership(publicKey)) {
          if (isMounted) {
            setExpenses([]);
            setIsLoading(false);
          }
          return;
        }
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw && isMounted) setExpenses(JSON.parse(raw) as Expense[]);
        } catch {
          // ignore
        }
        if (isMounted) setIsLoading(false);
        return;
      }

      try {
        // Try loading from Supabase
        const { data, error } = await client
          .from("expenses")
          .select("*")
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (isMounted && data) {
          const expenses = data.map(dbRowToExpense);
          setExpenses(expenses);
          localStorage.setItem(cacheKey, JSON.stringify(expenses));
        }
      } catch (err) {
        logWarn("expense.load_failed_using_cache", { fields: supabaseErrorFields(err) });
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw && isMounted) setExpenses(JSON.parse(raw) as Expense[]);
        } catch {
          // ignore
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadExpenses();

    return () => {
      isMounted = false;
    };
  }, [client, publicKey]);

  // Realtime authorizes on the socket's own JWT, so the feed has to run on the
  // authenticated client too — the anon client would receive nothing.
  useEffect(() => {
    if (!client || !publicKey) return;

    const cacheKey = getWalletScopedKey(LS_EXPENSES, publicKey);

    const channel = client
      .channel("expenses-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "expenses" },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const row = payload.new;
          if (!row || !isRowForWallet(row, publicKey)) return;
          const newExpense = dbRowToExpense(row);
          setExpenses((prev) => {
            if (prev.some((e) => e.id === newExpense.id)) return prev;
            const updated = [newExpense, ...prev];
            localStorage.setItem(cacheKey, JSON.stringify(updated));
            return updated;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "expenses" },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const row = payload.new;
          if (!row || !isRowForWallet(row, publicKey)) return;
          const updatedExpense = dbRowToExpense(row);
          setExpenses((prev) => {
            const updated = prev.map((e) =>
              e.id === updatedExpense.id ? updatedExpense : e
            );
            localStorage.setItem(cacheKey, JSON.stringify(updated));
            return updated;
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "expenses" },
        (payload: RealtimePostgresChangesPayload<any>) => {
          const row = payload.old;
          if (!row || !isRowForWallet(row, publicKey)) return;
          const deletedId = row?.id;
          if (!deletedId) return;
          setExpenses((prev) => {
            const updated = prev.filter((e) => e.id !== deletedId);
            localStorage.setItem(cacheKey, JSON.stringify(updated));
            return updated;
          });
        }
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Realtime dying is silent to the user: the list simply stops
          // updating, so it must be reported rather than printed.
          reportError("expense.realtime_failed", err, { fields: { status } });
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [client, publicKey]);

  const addExpense = useCallback(async (expense: Expense) => {
    if (!publicKey) throw new Error("Wallet not connected");

    const cacheKey = getWalletScopedKey(LS_EXPENSES, publicKey);

    setExpenses((prev) => {
      const updated = [expense, ...prev];
      localStorage.setItem(cacheKey, JSON.stringify(updated));
      return updated;
    });

    // Persist to Supabase — throw on failure so the caller can handle it
    const client = await getClient();
    const { error } = await client
      .from("expenses")
      .insert([expenseToDbInsertRow(expense, publicKey)]);

    if (error) {
      setExpenses((prev) => {
        const rolled = prev.filter((e) => e.id !== expense.id);
        localStorage.setItem(cacheKey, JSON.stringify(rolled));
        return rolled;
      });
      throw error;
    }
  }, [getClient, publicKey]);

  const updateExpense = useCallback(
    async (id: string, updates: Partial<Expense>) => {
      const current = expenses.find((e) => e.id === id);
      if (!current) return;

      const cacheKey = publicKey ? getWalletScopedKey(LS_EXPENSES, publicKey) : LS_EXPENSES;
      const merged = { ...current, ...updates };

      // Optimistic update
      setExpenses((prev) => {
        const updated = prev.map((e) => (e.id === id ? merged : e));
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();

        // Build partial update payload containing only mutable fields.
        // Never send created_by_wallet, created_at, or id in an UPDATE.
        const dbUpdates: Record<string, any> = {};
        if (updates.title !== undefined) dbUpdates.title = updates.title;
        if (updates.description !== undefined) dbUpdates.description = updates.description ?? null;
        if (updates.totalAmount !== undefined) dbUpdates.total_amount = updates.totalAmount;
        if (updates.currency !== undefined) dbUpdates.currency = updates.currency;
        if (updates.splitMode !== undefined) dbUpdates.split_mode = updates.splitMode;
        if (updates.paidByMemberId !== undefined) dbUpdates.paid_by_member_id = updates.paidByMemberId;
        if (updates.members !== undefined) {
          dbUpdates.members = updates.members;
          const memberWallets = updates.members
            .map((m) => m.walletAddress)
            .filter((addr): addr is string => !!addr);
          dbUpdates.member_wallets = memberWallets;
        }
        if (updates.shares !== undefined) dbUpdates.shares = updates.shares;
        if (updates.settled !== undefined) dbUpdates.settled = updates.settled;

        // Guard the write with the version we based `merged` on. Without this
        // predicate two concurrent editors both read v1, both write, and the
        // later write silently discards the earlier one -- including a share
        // someone just settled on-chain, which would resurface a Pay button for
        // a payment that already happened.
        const baseVersion = current.version ?? 1;
        dbUpdates.version = baseVersion + 1;

        const { data, error } = await client
          .from("expenses")
          .update(dbUpdates)
          .eq("id", id)
          .eq("version", baseVersion)
          .select("*");

        if (error) throw error;

        // Zero rows means the predicate did not match: someone else wrote first.
        // Re-read so the caller sees the winning row rather than a stale local
        // copy, and fail loudly instead of pretending the edit landed.
        if (!data || data.length === 0) {
          const { data: fresh } = await client
            .from("expenses")
            .select("*")
            .eq("id", id)
            .single();

          if (fresh) {
            const winner = dbRowToExpense(fresh);
            setExpenses((prev) => {
              const synced = prev.map((e) => (e.id === id ? winner : e));
              localStorage.setItem(cacheKey, JSON.stringify(synced));
              return synced;
            });
          }

          throw new ExpenseConflictError(
            "This expense was changed by someone else while you were editing. " +
              "Your view has been refreshed — please reapply your change.",
          );
        }

        // Adopt the row the database actually stored, so the local version
        // token tracks the server's and the next edit is checked against it.
        const stored = dbRowToExpense(data[0]);
        setExpenses((prev) => {
          const synced = prev.map((e) => (e.id === id ? stored : e));
          localStorage.setItem(cacheKey, JSON.stringify(synced));
          return synced;
        });
      } catch (err) {
        reportError("expense.update_failed", err, {
          fields: { expenseId: id, ...supabaseErrorFields(err) },
        });
        // A conflict already replaced local state with the winning row. Rolling
        // back to `current` here would overwrite it with the very stale copy
        // this guard exists to reject.
        if (!(err instanceof ExpenseConflictError)) {
          setExpenses((prev) => {
            const rolled = prev.map((e) => (e.id === id ? current : e));
            localStorage.setItem(cacheKey, JSON.stringify(rolled));
            return rolled;
          });
        }
        throw err;
      }
    },
    [expenses, getClient, publicKey]
  );

  const deleteExpense = useCallback(
    async (id: string) => {
      const current = expenses.find((e) => e.id === id);
      if (!current) return;

      const cacheKey = publicKey ? getWalletScopedKey(LS_EXPENSES, publicKey) : LS_EXPENSES;

      // Optimistic deletion
      setExpenses((prev) => {
        const updated = prev.filter((e) => e.id !== id);
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();
        const { error } = await client.from("expenses").delete().eq("id", id);

        if (error) throw error;
      } catch (err) {
        reportError("expense.delete_failed", err, {
          fields: { expenseId: id, ...supabaseErrorFields(err) },
        });
        // Roll back optimistic deletion on error
        setExpenses((prev) => {
          if (prev.some((e) => e.id === id)) return prev;
          const rolled = [current, ...prev];
          localStorage.setItem(cacheKey, JSON.stringify(rolled));
          return rolled;
        });
        throw err;
      }
    },
    [expenses, getClient]
  );

  const markSharePaid = useCallback(
    async (expenseId: string, memberId: string, txHash: string) => {
      const current = expenses.find((e) => e.id === expenseId);
      if (!current) throw new Error("Expense not found in state — please refresh and try again.");

      const cacheKey = publicKey ? getWalletScopedKey(LS_EXPENSES, publicKey) : LS_EXPENSES;

      // Optimistic local state update
      setExpenses((prev) => {
        const updated = prev.map((e) => {
          if (e.id !== expenseId) return e;
          const shares = e.shares.map((s) =>
            s.memberId === memberId ? { ...s, paid: true, txHash } : s
          );
          const settled = shares.every((s) => s.paid);
          return { ...e, shares, settled };
        });
        localStorage.setItem(cacheKey, JSON.stringify(updated));
        return updated;
      });

      try {
        const client = await getClient();

        // 1. Primary path: Atomic server-side RPC (row-locked in Postgres)
        let rpcSucceeded = false;
        try {
          const { data: rpcData, error: rpcErr } = await client
            .rpc("mark_share_paid", {
              p_expense_id: expenseId,
              p_member_id: memberId,
              p_tx_hash: txHash,
            });

          if (!rpcErr && rpcData && rpcData.length > 0) {
            const updatedRow = dbRowToExpense(rpcData[0]);
            setExpenses((prev) => {
              const synced = prev.map((e) => (e.id === expenseId ? updatedRow : e));
              localStorage.setItem(cacheKey, JSON.stringify(synced));
              return synced;
            });
            rpcSucceeded = true;
          }
        } catch (rpcErr) {
          logWarn("expense.mark_share_paid_rpc_unavailable", {
            fields: { expenseId, ...supabaseErrorFields(rpcErr) },
          });
        }

        if (rpcSucceeded) return;

        // 2. Fallback path: Optimistic Concurrency Control (OCC) with Retry Loop
        const MAX_RETRIES = 5;
        let lastError: unknown = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
          const { data: freshData, error: fetchErr } = await client
            .from("expenses")
            .select("*")
            .eq("id", expenseId)
            .single();

          if (fetchErr) throw fetchErr;

          const currentVersion = freshData.version ?? 1;
          const existingShares = (freshData.shares as SplitShare[]) || [];

          // Merge: preserve any other members marked paid concurrently
          const freshShares = existingShares.map((s: SplitShare) =>
            s.memberId === memberId ? { ...s, paid: true, txHash } : s
          );
          const freshSettled = freshShares.every((s: SplitShare) => s.paid);

          // Update conditionally matching the version token
          const { data: rowsUpdated, error: updateErr } = await client
            .from("expenses")
            .update({
              shares: freshShares,
              settled: freshSettled,
              version: currentVersion + 1,
            })
            .eq("id", expenseId)
            .eq("version", currentVersion)
            .select("*");

          if (updateErr) {
            lastError = updateErr;
            // If column 'version' does not exist in db, fallback to direct update
            if (String(updateErr.message || "").includes("version")) {
              const { data: fallbackRows, error: fallbackErr } = await client
                .from("expenses")
                .update({
                  shares: freshShares,
                  settled: freshSettled,
                })
                .eq("id", expenseId)
                .select("*");

              if (fallbackErr) throw fallbackErr;
              if (fallbackRows && fallbackRows.length > 0) {
                const updatedExpense = dbRowToExpense(fallbackRows[0]);
                setExpenses((prev) => {
                  const synced = prev.map((e) => (e.id === expenseId ? updatedExpense : e));
                  localStorage.setItem(cacheKey, JSON.stringify(synced));
                  return synced;
                });
                return;
              }
            }
          }

          if (rowsUpdated && rowsUpdated.length > 0) {
            const updatedExpense = dbRowToExpense(rowsUpdated[0]);
            setExpenses((prev) => {
              const synced = prev.map((e) => (e.id === expenseId ? updatedExpense : e));
              localStorage.setItem(cacheKey, JSON.stringify(synced));
              return synced;
            });
            return;
          }

          // Conflict detected (version changed by concurrent writer) - backoff and retry
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 40 * (attempt + 1) + Math.random() * 40));
          }
        }

        throw lastError || new Error("Failed to record payment due to concurrent updates. Please try again.");
      } catch (err) {
        // The payment settled on Stellar but the database does not reflect it:
        // the ledger and the app now disagree about who has paid.
        reportError("expense.mark_share_paid_failed", err, {
          fields: { expenseId, ...supabaseErrorFields(err) },
        });
        setExpenses((prev) => {
          const rolled = prev.map((e) => (e.id === expenseId ? current : e));
          localStorage.setItem(cacheKey, JSON.stringify(rolled));
          return rolled;
        });
        throw err;
      }
    },
    [expenses, getClient]
  );

  const getExpense = useCallback(
    (id: string) => expenses.find((e) => e.id === id),
    [expenses]
  );

  return (
    <ExpenseContext.Provider
      value={{
        expenses,
        addExpense,
        updateExpense,
        deleteExpense,
        markSharePaid,
        getExpense,
        isLoading,
      }}
    >
      {children}
    </ExpenseContext.Provider>
  );
}

export function useExpenseContext(): ExpenseContextType {
  const ctx = useContext(ExpenseContext);
  if (!ctx) throw new Error("useExpenseContext must be used within <ExpenseProvider />");
  return ctx;
}
