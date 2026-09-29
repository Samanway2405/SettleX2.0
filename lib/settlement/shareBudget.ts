import { xlmToStroops } from "@/lib/split/calculator";
import type { NetPayment } from "@/lib/settlement/netBalance";
import type { Expense } from "@/types/expense";

export type CoveredShare = {
  expenseId: string;
  memberId: string;
};

/**
 * Selects whole shares covered by a net payment using exact stroop arithmetic.
 *
 * Shares are intentionally never partially closed. Once the next matching
 * share exceeds the remaining budget, later shares are left untouched too,
 * preserving the existing deterministic expense order.
 */
export function selectCoveredShares(
  payment: NetPayment,
  expenses: Expense[],
): CoveredShare[] {
  let budgetRemaining = xlmToStroops(payment.amount);
  const covered: CoveredShare[] = [];

  outer: for (const expense of expenses) {
    const payer = expense.members.find(
      (member) => member.id === expense.paidByMemberId,
    );
    if (!payer || payer.id !== payment.toId) continue;

    for (const share of expense.shares) {
      if (share.memberId !== payment.fromId || share.paid) continue;

      const shareAmount = xlmToStroops(share.amount);
      if (budgetRemaining < shareAmount) break outer;

      budgetRemaining -= shareAmount;
      covered.push({ expenseId: expense.id, memberId: share.memberId });
      if (budgetRemaining === 0n) break outer;
    }
  }

  return covered;
}
