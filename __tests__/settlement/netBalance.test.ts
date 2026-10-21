import { computeNetPayments, type RawDebt } from "@/lib/settlement/netBalance";

const debt = (
  from: string,
  to: string,
  amount: number | string | bigint,
  fromWallet?: string,
  toWallet?: string,
): RawDebt => ({ from, fromId: from, to, toId: to, amount, fromWallet, toWallet });

describe("computeNetPayments", () => {
  it("produces one payment for a simple single debt", () => {
    const result = computeNetPayments([debt("Alice", "Bob", 100)]);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("Alice");
    expect(result[0].to).toBe("Bob");
    expect(result[0].fromId).toBe("Alice");
    expect(result[0].toId).toBe("Bob");
    expect(parseFloat(result[0].amount)).toBeCloseTo(100, 5);
  });

  it("returns empty array when there are no debts", () => {
    expect(computeNetPayments([])).toHaveLength(0);
  });

  it("nets opposing debts between two people", () => {
    const result = computeNetPayments([
      debt("Alice", "Bob", 100),
      debt("Bob", "Alice", 40),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("Alice");
    expect(result[0].to).toBe("Bob");
    expect(parseFloat(result[0].amount)).toBeCloseTo(60, 5);
  });

  it("produces zero payments when debts exactly cancel out", () => {
    expect(computeNetPayments([
      debt("Alice", "Bob", 50),
      debt("Bob", "Alice", 50),
    ])).toHaveLength(0);
  });

  it("produces minimal payments for a chain of 3 people", () => {
    const result = computeNetPayments([
      debt("A", "B", 100),
      debt("B", "C", 100),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("A");
    expect(result[0].to).toBe("C");
    expect(parseFloat(result[0].amount)).toBeCloseTo(100, 5);
  });

  it("works with multiple creditors and debtors", () => {
    const result = computeNetPayments([
      debt("Bob", "Alice", 30),
      debt("Carol", "Alice", 70),
    ]);
    const total = result.reduce((sum, payment) => sum + parseFloat(payment.amount), 0);
    expect(total).toBeCloseTo(100, 5);
    result.forEach((payment) => expect(payment.to).toBe("Alice"));
  });

  it("propagates wallet addresses to the result", () => {
    const result = computeNetPayments([debt("Alice", "Bob", 50, "GABC", "GXYZ")]);
    expect(result[0].fromWallet).toBe("GABC");
    expect(result[0].toWallet).toBe("GXYZ");
  });

  it("amounts in the result are strings with 7 decimal places", () => {
    const result = computeNetPayments([debt("A", "B", 33.3333333)]);
    expect(result[0].amount).toMatch(/^\d+\.\d{7}$/);
  });

  it("handles string and bigint amounts with exact stroop arithmetic", () => {
    const result = computeNetPayments([
      debt("Alice", "Bob", "0.0000003"),
      debt("Bob", "Alice", 1000000n),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe("Bob");
    expect(result[0].to).toBe("Alice");
    expect(result[0].amount).toBe("0.0999997");
  });

  it("keeps distinct members with the same display name separate", () => {
    const result = computeNetPayments([
      { from: "Sam", fromId: "member-1", to: "Alex", toId: "member-3", amount: 20 },
      { from: "Alex", fromId: "member-3", to: "Sam", toId: "member-2", amount: 5 },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map(({ fromId, toId }) => [fromId, toId])).toEqual([
      ["member-1", "member-3"],
      ["member-3", "member-2"],
    ]);
  });
});
