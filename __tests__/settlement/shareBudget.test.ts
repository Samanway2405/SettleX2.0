import { selectCoveredShares } from "@/lib/settlement/shareBudget";
import type { Expense } from "@/types/expense";
import type { NetPayment } from "@/lib/settlement/netBalance";

const payer = { id: "payer", name: "Payer", walletAddress: "GPAYER" };
const debtor = { id: "debtor", name: "Debtor", walletAddress: "GDEBTOR" };

function payment(amount: string): NetPayment {
  return {
    from: debtor.name,
    fromId: debtor.id,
    fromWallet: debtor.walletAddress,
    to: payer.name,
    toId: payer.id,
    toWallet: payer.walletAddress,
    amount,
  };
}

function expense(id: string, amount: string, paid = false): Expense {
  return {
    id,
    title: id,
    totalAmount: amount,
    currency: "XLM",
    splitMode: "equal",
    paidByMemberId: payer.id,
    members: [payer, debtor],
    shares: [{
      memberId: debtor.id,
      name: debtor.name,
      walletAddress: debtor.walletAddress,
      amount,
      paid,
    }],
    createdAt: "2026-01-01T00:00:00.000Z",
    settled: false,
  };
}

describe("selectCoveredShares", () => {
  it("closes shares exactly covered down to one stroop", () => {
    const covered = selectCoveredShares(payment("1.0000000"), [
      expense("first", "0.3333333"),
      expense("second", "0.6666667"),
    ]);

    expect(covered).toEqual([
      { expenseId: "first", memberId: debtor.id },
      { expenseId: "second", memberId: debtor.id },
    ]);
  });

  it("does not use an epsilon to over-mark by one stroop", () => {
    const covered = selectCoveredShares(payment("1.0000000"), [
      expense("first", "0.3333333"),
      expense("one-stroop-too-much", "0.6666668"),
      expense("later", "0.1000000"),
    ]);

    expect(covered).toEqual([
      { expenseId: "first", memberId: debtor.id },
    ]);
  });

  it("ignores paid, unrelated-debtor, and unrelated-payer shares", () => {
    const otherDebtor = { ...debtor, id: "other-debtor" };
    const unrelated = expense("unrelated", "0.1000000");
    unrelated.shares[0].memberId = otherDebtor.id;

    const wrongPayer = expense("wrong-payer", "0.1000000");
    wrongPayer.paidByMemberId = debtor.id;

    expect(selectCoveredShares(payment("0.1000000"), [
      expense("already-paid", "0.1000000", true),
      unrelated,
      wrongPayer,
      expense("covered", "0.1000000"),
    ])).toEqual([
      { expenseId: "covered", memberId: debtor.id },
    ]);
  });
});
