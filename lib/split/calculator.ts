import type { Member, SplitShare } from "@/types/expense";

export function xlmToStroops(xlm: string | number | bigint): bigint {
  if (typeof xlm === "bigint") return xlm;
  if (typeof xlm === "number") {
    if (!Number.isFinite(xlm)) throw new Error("Invalid XLM amount: not finite");
    xlm = xlm.toString();
  }
  const str = xlm.trim();
  if (!str) throw new Error("Invalid XLM amount: empty string");

  const isNegative = str.startsWith("-");
  const cleanStr = isNegative ? str.slice(1) : str;
  const parts = cleanStr.split(".");
  if (parts.length > 2) throw new Error(`Invalid XLM amount format: ${str}`);

  const wholePart = parts[0] || "0";
  const fracPart = parts[1] || "";

  if (!/^\d+$/.test(wholePart) || (fracPart && !/^\d+$/.test(fracPart))) {
    throw new Error(`Invalid XLM amount format: ${str}`);
  }

  const whole = BigInt(wholePart);
  const fracStr = fracPart.padEnd(7, "0").slice(0, 7);
  const frac = BigInt(fracStr);
  const total = whole * 10_000_000n + frac;
  return isNegative ? -total : total;
}

export function stroopsToXlm(stroops: bigint | string | number): string {
  const n = BigInt(stroops);
  const isNegative = n < 0n;
  const abs = isNegative ? -n : n;
  const whole = abs / 10_000_000n;
  const frac = abs % 10_000_000n;
  const formatted = `${whole}.${frac.toString().padStart(7, "0")}`;
  return isNegative ? `-${formatted}` : formatted;
}

export function calculateEqualSplit(
  totalXLM: number | string | bigint,
  members: Member[],
  paidByMemberId: string
): SplitShare[] {
  if (members.length === 0) return [];

  const totalStroops = xlmToStroops(totalXLM);
  if (totalStroops < 0n) {
    throw new Error("Total XLM amount cannot be negative");
  }

  const nonPayers = members.filter((m) => m.id !== paidByMemberId);
  if (nonPayers.length === 0) return [];

  const count = BigInt(members.length);
  const baseShare = totalStroops / count;
  const remainder = totalStroops % count;

  return nonPayers.map((m) => {
    const memberIndex = members.findIndex((member) => member.id === m.id);
    const extra = BigInt(memberIndex) < remainder ? 1n : 0n;
    const shareStroops = baseShare + extra;

    return {
      memberId: m.id,
      name: m.name,
      walletAddress: m.walletAddress,
      amount: stroopsToXlm(shareStroops),
      paid: false,
    };
  });
}

export function calculateCustomSplit(
  totalXLM: number | string | bigint,
  members: Member[],
  paidByMemberId: string
): SplitShare[] {
  if (members.length === 0) return [];

  const totalStroops = xlmToStroops(totalXLM);
  if (totalStroops < 0n) {
    throw new Error("Total XLM amount cannot be negative");
  }

  for (const m of members) {
    const w = m.weight ?? 1;
    if (typeof w !== "number" || isNaN(w) || w <= 0 || !Number.isFinite(w)) {
      throw new Error(`Invalid weight for member ${m.name || m.id}: weight must be a positive number`);
    }
  }

  const nonPayers = members.filter((m) => m.id !== paidByMemberId);
  if (nonPayers.length === 0) return [];

  const totalWeight = members.reduce((s, m) => s + (m.weight ?? 1), 0);
  if (totalWeight <= 0 || isNaN(totalWeight) || !Number.isFinite(totalWeight)) {
    throw new Error("Total weight must be greater than zero");
  }

  const totalWeightBigInt = BigInt(totalWeight);

  const memberAllocations = members.map((m, index) => {
    const weight = BigInt(m.weight ?? 1);
    const stroopsShare = (totalStroops * weight) / totalWeightBigInt;
    const remainderPart = (totalStroops * weight) % totalWeightBigInt;
    return {
      member: m,
      index,
      stroops: stroopsShare,
      remainderPart,
    };
  });

  const allocatedStroops = memberAllocations.reduce((sum, item) => sum + item.stroops, 0n);
  let leftoverStroops = totalStroops - allocatedStroops;

  const sortedByRemainder = [...memberAllocations].sort((a, b) => {
    if (b.remainderPart > a.remainderPart) return 1;
    if (b.remainderPart < a.remainderPart) return -1;
    return a.index - b.index;
  });

  for (let i = 0; i < sortedByRemainder.length && leftoverStroops > 0n; i++) {
    const target = memberAllocations.find((item) => item.index === sortedByRemainder[i].index);
    if (target) {
      target.stroops += 1n;
      leftoverStroops -= 1n;
    }
  }

  return nonPayers.map((m) => {
    const allocation = memberAllocations.find((item) => item.member.id === m.id)!;
    return {
      memberId: m.id,
      name: m.name,
      walletAddress: m.walletAddress,
      amount: stroopsToXlm(allocation.stroops),
      paid: false,
    };
  });
}

export function calculateSplit(
  totalXLM: number | string | bigint,
  members: Member[],
  paidByMemberId: string,
  mode: "equal" | "custom"
): SplitShare[] {
  return mode === "custom"
    ? calculateCustomSplit(totalXLM, members, paidByMemberId)
    : calculateEqualSplit(totalXLM, members, paidByMemberId);
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export { MIN_SPLIT_WEIGHT, MAX_SPLIT_WEIGHT } from "@/lib/utils/constants";
import { MIN_SPLIT_WEIGHT, MAX_SPLIT_WEIGHT } from "@/lib/utils/constants";

export function isValidSplitWeight(weight: number | undefined): weight is number {
  return (
    typeof weight === "number" &&
    Number.isInteger(weight) &&
    weight >= MIN_SPLIT_WEIGHT &&
    weight <= MAX_SPLIT_WEIGHT
  );
}

export function isValidXLMAmount(value: string): boolean {
  try {
    const stroops = xlmToStroops(value);
    return stroops > 0n && stroops <= 1_000_000_000_000_000n;
  } catch {
    return false;
  }
}

export function isValidStellarAddress(address: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(address);
}
