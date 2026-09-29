import type { Expense, Member } from "./expense";

export interface Trip {
  id: string;
  name: string;
  description?: string;
  members: Member[];
  expenseIds: string[];
  createdAt: string;
  createdByWallet?: string;
  memberWallets?: string[];
  acceptedWallets?: string[];
  settled: boolean;
}

export type TripFormData = {
  name: string;
  description: string;
  members: Member[];
};
