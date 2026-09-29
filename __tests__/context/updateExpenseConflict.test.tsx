/** @jest-environment jsdom */

/**
 * Regression tests for the second half of "concurrent markSharePaid calls lose
 * updates on the shares JSONB blob".
 *
 * markSharePaid itself now goes through the row-locked mark_share_paid RPC.
 * updateExpense did not: it wrote the full row with no version predicate, so a
 * concurrent editor's write -- including a share someone had just settled
 * on-chain -- was silently clobbered by whoever wrote last.
 */
import React from "react";
import type { Expense } from "@/types/expense";
import { LS_EXPENSES, getWalletScopedKey } from "@/lib/utils/constants";

const { render, screen, waitFor, act } = require("@testing-library/react");

const WALLET = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";

jest.mock("@/context/WalletContext", () => ({
  useWalletContext: () => ({ publicKey: WALLET }),
}));

jest.mock("@/lib/supabase/session", () => ({
  getAuthenticatedClient: jest.fn(),
  requireAuthenticatedClient: jest.fn(),
  clearWalletSession: jest.fn(),
  readStoredSession: jest.fn(() => ({
    walletAddress: WALLET,
    accessToken: "token",
    expiresAt: Date.now() + 3600_000,
  })),
  onSessionChange: jest.fn(() => () => {}),
}));

const { getAuthenticatedClient, requireAuthenticatedClient } = require("@/lib/supabase/session");
const { ExpenseProvider, useExpenseContext } = require("@/context/ExpenseContext");

/** The row as the database holds it, shared by the mock client below. */
let dbRow: Record<string, unknown>;
/** Set to simulate another writer committing between our read and our write. */
let concurrentWriter: (() => void) | null = null;
let updatePayloads: Record<string, unknown>[] = [];

function baseRow() {
  return {
    id: "exp-1",
    title: "Team Dinner",
    description: null,
    total_amount: "100.0000000",
    currency: "XLM",
    split_mode: "equal",
    paid_by_member_id: "m1",
    members: [{ id: "m1", name: "Alice" }, { id: "m2", name: "Bob" }],
    shares: [
      { memberId: "m1", name: "Alice", amount: "50.0000000", paid: false },
      { memberId: "m2", name: "Bob", amount: "50.0000000", paid: false },
    ],
    created_at: "2026-01-01T00:00:00Z",
    settled: false,
    version: 1,
    created_by_wallet: WALLET,
    member_wallets: [WALLET],
    accepted_wallets: [WALLET],
  };
}

/**
 * Minimal Supabase stand-in. `update()` honours an `.eq("version", n)`
 * predicate the way Postgres would: no match, no rows, no write.
 */
function makeClient() {
  return {
    from: () => {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        insert: () => builder,
        delete: () => builder,
        update: (payload: Record<string, unknown>) => {
          builder.__payload = payload;
          builder.__isUpdate = true;
          // Another client commits between our read and our write.
          if (concurrentWriter) {
            concurrentWriter();
            concurrentWriter = null;
          }
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        single: async () => ({ data: { ...dbRow }, error: null }),
        order: () => builder,
        then: undefined,
      };

      // Awaiting the builder resolves the query.
      (builder as { then: unknown }).then = (
        resolve: (value: { data: unknown; error: unknown }) => void,
      ) => {
        if (!builder.__isUpdate) {
          resolve({ data: [{ ...dbRow }], error: null });
          return;
        }

        const payload = builder.__payload as Record<string, unknown>;
        updatePayloads.push(payload);

        if ("version" in filters && filters.version !== dbRow.version) {
          resolve({ data: [], error: null }); // predicate missed
          return;
        }

        Object.assign(dbRow, payload);
        resolve({ data: [{ ...dbRow }], error: null });
      };

      return builder;
    },
    channel: () => {
      // `.on()` chains, so it has to return the channel itself.
      const ch: Record<string, unknown> = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => {},
  };
}

let ctx: { expenses: Expense[]; updateExpense: (id: string, u: Partial<Expense>) => Promise<void> };

function Probe() {
  ctx = useExpenseContext();
  return <div data-testid="titles">{ctx.expenses.map((e) => e.title).join("|")}</div>;
}

beforeEach(async () => {
  localStorage.clear();
  updatePayloads = [];
  concurrentWriter = null;
  dbRow = baseRow();

  const client = makeClient();
  getAuthenticatedClient.mockResolvedValue(client);
  requireAuthenticatedClient.mockResolvedValue(client);

  render(
    <ExpenseProvider>
      <Probe />
    </ExpenseProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("titles").textContent).toBe("Team Dinner"));
});

describe("updateExpense concurrency", () => {
  it("guards the write with the version it read", async () => {
    await act(async () => {
      await ctx.updateExpense("exp-1", { title: "Renamed" });
    });

    expect(updatePayloads[0].version).toBe(2);
    expect(dbRow.title).toBe("Renamed");
  });

  it("does not clobber a share settled by a concurrent writer", async () => {
    // Bob pays while Alice has the edit form open.
    concurrentWriter = () => {
      dbRow.version = 2;
      dbRow.shares = [
        { memberId: "m1", name: "Alice", amount: "50.0000000", paid: false },
        { memberId: "m2", name: "Bob", amount: "50.0000000", paid: true, txHash: "tx-bob" },
      ];
    };

    let thrown: unknown;
    await act(async () => {
      thrown = await ctx.updateExpense("exp-1", { title: "Renamed" }).catch((e: unknown) => e);
    });
    expect((thrown as Error).message).toMatch(/changed by someone else/i);

    // Bob's on-chain payment survived — the whole point of the guard.
    const shares = dbRow.shares as { memberId: string; paid: boolean }[];
    expect(shares.find((s) => s.memberId === "m2")?.paid).toBe(true);
    expect(dbRow.title).toBe("Team Dinner");
  });

  it("refreshes local state to the winning row instead of the stale copy", async () => {
    concurrentWriter = () => {
      dbRow.version = 2;
      dbRow.title = "Winner";
    };

    let thrown: unknown;
    await act(async () => {
      thrown = await ctx.updateExpense("exp-1", { title: "Loser" }).catch((e: unknown) => e);
    });
    expect((thrown as Error).message).toMatch(/changed by someone else/i);

    // Not rolled back to the pre-edit copy, and not left showing "Loser".
    await waitFor(() => expect(screen.getByTestId("titles").textContent).toBe("Winner"));
  });

  it("adopts the stored version so a follow-up edit is checked against it", async () => {
    await act(async () => {
      await ctx.updateExpense("exp-1", { title: "First" });
    });
    await act(async () => {
      await ctx.updateExpense("exp-1", { title: "Second" });
    });

    // Second write guarded on v2 (not a stale v1) and landed.
    expect(updatePayloads[1].version).toBe(3);
    expect(dbRow.title).toBe("Second");
  });
});
