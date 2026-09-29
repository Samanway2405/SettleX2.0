export interface ContractPaymentRecord {
  tripId: string;
  expenseId: string;
  payer: string;
  member: string;
  amountStroops: bigint;
  txHash: string;
  timestamp: number;
  /**
   * `true` only when a configured attestor co-signed the record, meaning the
   * Stellar transaction behind `txHash` was actually checked.
   *
   * `false` means the record is self-attested: the member supplied `payer`,
   * `amountStroops` and `txHash`, and the contract stored them without
   * verifying any of it. Never present a self-attested record as proof.
   */
  attested: boolean;
  /**
   * `true` when an admin repudiated this record via `clear_paid`.
   *
   * The contract keeps voided records in trip history on purpose — the audit
   * trail is the point — so consumers must not present one as a legitimate
   * payment. Filter it out or mark it visibly; never render it as though it
   * still stands.
   */
  voided: boolean;
}

// Contract call status

export type ContractCallStatus =
  | { status: "idle" }
  | { status: "simulating" }
  | { status: "signing" }
  | { status: "sending" }
  | { status: "confirming" }
  | { status: "success"; ledger: number }
  | { status: "error"; message: string; code?: number };

export enum ContractErrorCode {
  InvalidAmount = 1,
  AlreadyPaid   = 2,
  EmptyId       = 3,
  AlreadyInitialized = 4,
  NotInitialized = 5,
  InvalidActor = 6,
  IdTooLong = 7,
  AmountTooLarge = 8,
  VersionMismatch = 9,
  TxHashTooLong = 10,
  NotPaid = 11,
  Unauthorized = 12,
  InvalidPage = 13,
  IndexOverflow = 14,
}

export enum PoolErrorCode {
  AlreadyInitialized = 101,
  NotInitialized = 102,
  Unauthorized = 103,
  InvalidAmount = 104,
  InsufficientBalance = 105,
  BalanceOverflow = 106,
  VersionMismatch = 107,
  InvalidActor = 108,
  AmountTooLarge = 109,
}

export interface ContractPaymentEvent {
  ledger: number;
  ledgerClosedAt: string;
  tripId: string;
  expenseId: string;
  member: string;
  amountStroops: string;
  txHash: string;
  /**
   * Only literal `true` means the event can be treated as verified payment
   * evidence. Missing/false events are self-attested claims.
   */
  attested?: boolean;
}

export interface GetPaymentsResult {
  payments: ContractPaymentRecord[];
  success: boolean;
  error?: string;
}

export interface IsPaidResult {
  paid: boolean;
  success: boolean;
  error?: string;
}
