import { parseExpenseRow, parseTripRow } from "@/lib/supabase/rowGuards";

const member = { id: "member-1", name: "Alex", weight: 1 };

function expenseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "expense-1",
    title: "Dinner",
    description: null,
    total_amount: "20.00",
    currency: "XLM",
    split_mode: "equal",
    paid_by_member_id: "member-1",
    members: [member],
    shares: [{ memberId: "member-1", name: "Alex", amount: "20.00", paid: false }],
    created_at: "2026-01-01T00:00:00.000Z",
    settled: false,
    created_by_wallet: "GCREATOR",
    member_wallets: ["GCREATOR"],
    accepted_wallets: ["GCREATOR"],
    ...overrides,
  };
}

describe("Supabase row guards", () => {
  it("parses valid rows and defaults a missing expense version", () => {
    expect(parseExpenseRow(expenseRow()).version).toBe(1);
    expect(parseTripRow({
      id: "trip-1",
      name: "Weekend",
      description: null,
      members: [member],
      expense_ids: [],
      created_at: "2026-01-01T00:00:00.000Z",
      created_by_wallet: "GCREATOR",
      member_wallets: ["GCREATOR"],
      accepted_wallets: ["GCREATOR"],
      settled: false,
    }).name).toBe("Weekend");
  });

  it.each([NaN, Infinity, -Infinity, 0, 1.5])(
    "rejects invalid expense version %p",
    (version) => {
      expect(() => parseExpenseRow(expenseRow({ version }))).toThrow(/version/);
    },
  );

  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite member weight %p",
    (weight) => {
      expect(() => parseExpenseRow(expenseRow({ members: [{ ...member, weight }] }))).toThrow(/weight/);
    },
  );
});
