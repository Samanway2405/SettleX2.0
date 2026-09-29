import type { Expense } from "@/types/expense";
import type { Trip } from "@/types/trip";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid value for ${field}: expected non-empty string.`);
  }
  return value;
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Invalid value for ${field}: expected string or null.`);
  }
  return value || undefined;
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid value for ${field}: expected boolean.`);
  }
  return value;
}

function asOptionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value == null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid value for ${field}: expected finite number.`);
  }
  return value;
}

function asVersion(value: unknown): number {
  if (value == null) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error("Invalid value for version: expected positive integer.");
  }
  return value;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Invalid value for ${field}: expected string[]`);
  }
  return value;
}

function asRecordArray(value: unknown, field: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Invalid value for ${field}: expected array of objects.`);
  }
  return value as Record<string, unknown>[];
}

export function parseExpenseRow(row: unknown): Expense {
  if (!isRecord(row)) {
    throw new Error("Expense row is malformed: expected object.");
  }

  const expense: Expense = {
    id: asString(row.id, "id"),
    title: asString(row.title, "title"),
    description: asOptionalString(row.description, "description"),
    totalAmount: asString(row.total_amount, "total_amount"),
    currency: asString(row.currency, "currency") as Expense["currency"],
    splitMode: asString(row.split_mode, "split_mode") as Expense["splitMode"],
    paidByMemberId: asString(row.paid_by_member_id, "paid_by_member_id"),
    members: asRecordArray(row.members, "members").map((member) => ({
      id: asString(member.id, "members[].id"),
      name: asString(member.name, "members[].name"),
      walletAddress: asOptionalString(member.walletAddress, "members[].walletAddress"),
      weight: asOptionalFiniteNumber(member.weight, "members[].weight"),
    })),
    shares: asRecordArray(row.shares, "shares").map((share) => ({
      memberId: asString(share.memberId, "shares[].memberId"),
      name: asString(share.name, "shares[].name"),
      walletAddress: asOptionalString(share.walletAddress, "shares[].walletAddress"),
      amount: asString(share.amount, "shares[].amount"),
      paid: typeof share.paid === "boolean" ? share.paid : (() => {
        throw new Error("Invalid value for shares[].paid: expected boolean.");
      })(),
      txHash: asOptionalString(share.txHash, "shares[].txHash"),
    })),
    createdAt: asString(row.created_at, "created_at"),
    settled: asBoolean(row.settled, "settled"),
    version: asVersion(row.version),
    createdByWallet: asString(row.created_by_wallet, "created_by_wallet"),
    memberWallets: asStringArray(row.member_wallets, "member_wallets"),
    acceptedWallets: asStringArray(row.accepted_wallets, "accepted_wallets"),
  };

  if (!expense.members.every((member) => typeof member.id === "string" && typeof member.name === "string")) {
    throw new Error("Expense row is malformed: member items are invalid.");
  }

  if (!expense.shares.every((share) => typeof share.memberId === "string" && typeof share.amount === "string")) {
    throw new Error("Expense row is malformed: share items are invalid.");
  }

  return expense;
}

export function parseTripRow(row: unknown): Trip {
  if (!isRecord(row)) {
    throw new Error("Trip row is malformed: expected object.");
  }

  const trip: Trip = {
    id: asString(row.id, "id"),
    name: asString(row.name, "name"),
    description: asOptionalString(row.description, "description"),
    members: asRecordArray(row.members, "members").map((member) => ({
      id: asString(member.id, "members[].id"),
      name: asString(member.name, "members[].name"),
      walletAddress: asOptionalString(member.walletAddress, "members[].walletAddress"),
      weight: asOptionalFiniteNumber(member.weight, "members[].weight"),
    })),
    expenseIds: asStringArray(row.expense_ids, "expense_ids"),
    createdAt: asString(row.created_at, "created_at"),
    createdByWallet: asString(row.created_by_wallet, "created_by_wallet"),
    memberWallets: asStringArray(row.member_wallets, "member_wallets"),
    acceptedWallets: asStringArray(row.accepted_wallets, "accepted_wallets"),
    settled: asBoolean(row.settled, "settled"),
  };

  return trip;
}

export function parseUserRow(row: unknown): { id: string; walletAddress: string; displayName: string; createdAt: string; updatedAt: string; lastLoginAt: string } {
  if (!isRecord(row)) {
    throw new Error("User row is malformed: expected object.");
  }

  return {
    id: asString(row.id, "id"),
    walletAddress: asString(row.wallet_address, "wallet_address"),
    displayName: asString(row.display_name, "display_name"),
    createdAt: asString(row.created_at, "created_at"),
    updatedAt: asString(row.updated_at, "updated_at"),
    lastLoginAt: asString(row.last_login_at, "last_login_at"),
  };
}
