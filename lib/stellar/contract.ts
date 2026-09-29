import {
  Contract,
  TransactionBuilder,
  Account,
  rpc,
  nativeToScVal,
  scValToNative,
  Address,
} from "@stellar/stellar-sdk";
import { sorobanServer } from "./soroban";
import { signXDR } from "@/lib/freighter";
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  HORIZON_URL,
} from "@/lib/utils/constants";
import { logWarn, reportError } from "@/lib/observability/logger";
import type {
  ContractPaymentRecord,
  GetPaymentsResult,
  IsPaidResult,
} from "@/types/contract";
import { ContractErrorCode, PoolErrorCode } from "@/types/contract";

const SOROBAN_BASE_FEE  = "1000";
const MAX_POLL_ATTEMPTS  = 20;
const POLL_INTERVAL_MS   = 2500;
const PAYMENT_EXPENSE_PAGE_SIZE = 50;
const MAX_PAYMENT_PAGES = 1000;

export function decodeContractError(raw: string): string {
  const match = raw.match(/Error\(Contract,\s*#(\d+)\)/);
  if (match) {
    const code = Number(match[1]);

    if (code >= 100) {
      switch (code) {
        case PoolErrorCode.AlreadyInitialized:
          return "Pool is already initialized.";
        case PoolErrorCode.NotInitialized:
          return "Pool contract is not initialized yet.";
        case PoolErrorCode.Unauthorized:
          return "Pool authorization failed.";
        case PoolErrorCode.InvalidAmount:
          return "Pool payment amount must be greater than zero.";
        case PoolErrorCode.InsufficientBalance:
          return "Pool balance is insufficient for this transfer.";
        case PoolErrorCode.BalanceOverflow:
          return "Pool balance overflowed.";
        case PoolErrorCode.VersionMismatch:
          return "Pool storage version mismatch.";
        case PoolErrorCode.InvalidActor:
          return "Invalid pool actor for this operation.";
        case PoolErrorCode.AmountTooLarge:
          return "Pool amount is above the allowed limit.";
        default:
          return `Pool error #${code}.`;
      }
    }

    switch (code) {
      case ContractErrorCode.InvalidAmount:
        return "Payment amount must be greater than zero.";
      case ContractErrorCode.AlreadyPaid:
        return "This expense was already settled on-chain. No double payment needed.";
      case ContractErrorCode.EmptyId:
        return "Trip ID or expense ID is missing — cannot record payment.";
      case ContractErrorCode.AlreadyInitialized:
        return "Contract is already initialized.";
      case ContractErrorCode.NotInitialized:
        return "Contract is not initialized yet.";
      case ContractErrorCode.InvalidActor:
        return "Invalid actor for this operation.";
      case ContractErrorCode.IdTooLong:
        return "Trip ID or expense ID is too long.";
      case ContractErrorCode.AmountTooLarge:
        return "Amount is above the allowed limit.";
      case ContractErrorCode.VersionMismatch:
        return "Contract storage version mismatch.";
      case ContractErrorCode.TxHashTooLong:
        return "Transaction hash is too long.";
      case ContractErrorCode.NotPaid:
        return "This expense has not been settled on-chain yet.";
      case ContractErrorCode.Unauthorized:
        return "Authorization failed for this operation.";
      case ContractErrorCode.InvalidPage:
        return "Payment history page size is invalid.";
      case ContractErrorCode.IndexOverflow:
        return "Payment history index is full.";
      default:
        return `Contract error #${code}.`;
    }
  }
  return raw;
}

async function loadAccount(publicKey: string): Promise<Account> {
  const res = await fetch(
    `${HORIZON_URL}/accounts/${publicKey}?_ts=${Date.now()}`,
    { cache: "no-store", headers: { "Cache-Control": "no-cache" } }
  );
  if (!res.ok) {
    throw new Error(
      `Failed to load Stellar account (${res.status}). Verify your address is funded on testnet.`
    );
  }
  const data = (await res.json()) as { sequence: string };
  return new Account(publicKey, data.sequence);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export { xlmToStroops, stroopsToXlm } from "@/lib/split/calculator";

function contractReady(caller: string): boolean {
  if (!CONTRACT_ID) {
    logWarn("contract.not_configured", {
      fields: { caller },
      message:
        "CONTRACT_ID not set — skipping on-chain step. Deploy the contract and " +
        "set NEXT_PUBLIC_CONTRACT_ID.",
    });
    return false;
  }
  return true;
}

export interface RecordPaymentParams {
  memberPublicKey: string;
  tripId: string;
  expenseId: string;
  payerPublicKey: string;
  amountXlm: string;
  txHash: string;
  onStatus?: (step: "simulating" | "signing" | "sending" | "confirming") => void;
}

export interface RecordPaymentResult {
  success: boolean;
  ledger?: number;
  error?: string;
}

export interface PoolPrecheckResult {
  ok: boolean;
  requiredStroops: bigint;
  balanceStroops?: bigint;
  shortfallStroops?: bigint;
  error?: string;
}

export async function precheckPoolBalance(
  callerPublicKey: string,
  memberPublicKey: string,
  amountXlm: string,
): Promise<PoolPrecheckResult> {
  const requiredStroops = xlmToStroops(amountXlm);

  if (!contractReady("precheckPoolBalance")) {
    return { ok: false, requiredStroops, error: "Contract not configured." };
  }

  // The pool requirement has been removed, so balance is always sufficient.
  return { ok: true, requiredStroops, balanceStroops: requiredStroops };
}

export async function recordPaymentOnChain(
  params: RecordPaymentParams
): Promise<RecordPaymentResult> {
  if (!contractReady("recordPaymentOnChain")) {
    return { success: false, error: "Contract not configured." };
  }

  const {
    memberPublicKey,
    tripId,
    expenseId,
    payerPublicKey,
    amountXlm,
    txHash,
    onStatus,
  } = params;

  try {
    const account  = await loadAccount(memberPublicKey);
    const contract = new Contract(CONTRACT_ID);

    const amountStroops = xlmToStroops(amountXlm);
    const contractArgs = [
      nativeToScVal(tripId,           { type: "string" }),
      nativeToScVal(expenseId,        { type: "string" }),
      new Address(payerPublicKey).toScVal(),
      new Address(memberPublicKey).toScVal(),
      nativeToScVal(amountStroops,    { type: "i128" }),
      nativeToScVal(txHash,           { type: "string" }),
    ];

    const tx = new TransactionBuilder(account, {
      fee:              SOROBAN_BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call("record_payment", ...contractArgs))
      .setTimeout(60)
      .build();

    onStatus?.("simulating");
    const simResult = await sorobanServer.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(simResult)) {
      throw new Error(decodeContractError(simResult.error));
    }
    if (!rpc.Api.isSimulationSuccess(simResult)) {
      throw new Error("Contract simulation returned an unexpected result.");
    }

    const assembled = rpc.assembleTransaction(tx, simResult).build();

    onStatus?.("signing");
    const signedXdr = await signXDR(assembled.toXDR(), NETWORK_PASSPHRASE);

    onStatus?.("sending");
    const sendResult = await sorobanServer.sendTransaction(
      TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE)
    );

    if (sendResult.status === "ERROR") {
      throw new Error(
        `Contract send failed: ${sendResult.errorResult?.result()?.toXDR("base64") ?? "unknown error"}`
      );
    }

    onStatus?.("confirming");
    const txHash_ = sendResult.hash;

    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const pollResult = await sorobanServer.getTransaction(txHash_);

      if (pollResult.status === rpc.Api.GetTransactionStatus.SUCCESS) {
        return { success: true, ledger: (pollResult as { ledger: number }).ledger };
      }
      if (pollResult.status === rpc.Api.GetTransactionStatus.FAILED) {
        const failedResult = pollResult as { resultXdr?: { toXDR?: () => unknown } };
        const rawMsg = failedResult.resultXdr
          ? `Contract error: ${String(failedResult.resultXdr)}`
          : "Contract transaction was submitted but failed on-chain.";
        throw new Error(decodeContractError(rawMsg));
      }
    }

    throw new Error("Contract transaction timed out waiting for confirmation.");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Contract call failed.";
    reportError("contract.record_payment_failed", err, {
      fields: { tripId, expenseId, txHash },
    });
    return { success: false, error: message };
  }
}

export async function getContractPayments(
  callerPublicKey: string,
  tripId: string
): Promise<GetPaymentsResult> {
  if (!contractReady("getContractPayments")) {
    return { payments: [], success: false, error: "Contract not configured." };
  }

  try {
    const account  = await loadAccount(callerPublicKey);
    const contract = new Contract(CONTRACT_ID);

    type RawPayment = {
      expense_id: string;
      payer: string;
      member: string;
      amount: bigint;
      tx_hash: string;
      timestamp: bigint;
      attested?: boolean;
      voided?: boolean;
    };
    type RawPaymentPage = {
      payments: RawPayment[];
      next_offset?: number | bigint | null;
    };

    const rawPayments: RawPayment[] = [];
    let offset = 0;

    for (let pageNumber = 0; pageNumber < MAX_PAYMENT_PAGES; pageNumber += 1) {
      const tx = new TransactionBuilder(account, {
        fee:              SOROBAN_BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            "get_payments",
            nativeToScVal(tripId, { type: "string" }),
            nativeToScVal(offset, { type: "u32" }),
            nativeToScVal(PAYMENT_EXPENSE_PAGE_SIZE, { type: "u32" }),
          )
        )
        .setTimeout(30)
        .build();

      const simResult = await sorobanServer.simulateTransaction(tx);
      if (
        rpc.Api.isSimulationError(simResult) ||
        !rpc.Api.isSimulationSuccess(simResult)
      ) {
        throw new Error("Simulation failed when reading trip payments.");
      }

      const retval = simResult.result?.retval;
      if (!retval) break;

      const page = scValToNative(retval) as RawPaymentPage;
      rawPayments.push(...page.payments);

      if (page.next_offset == null) break;
      const nextOffset = Number(page.next_offset);
      if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
        throw new Error("Contract returned an invalid payment history cursor.");
      }
      offset = nextOffset;

      if (pageNumber === MAX_PAYMENT_PAGES - 1) {
        throw new Error("Payment history exceeded the client pagination limit.");
      }
    }

    const payments: ContractPaymentRecord[] = rawPayments.map((r) => ({
      tripId:        tripId,
      expenseId:     r.expense_id,
      payer:         r.payer,
      member:        r.member,
      amountStroops: r.amount,
      txHash:        r.tx_hash,
      timestamp:     Number(r.timestamp),
      // Default to self-attested: a record from an older contract build that
      // predates the flag has verified nothing, so it must not read as proof.
      attested:      r.attested === true,
      // Default to not-voided. An older build has no marker to report, and
      // defaulting the other way would hide every legitimate record behind a
      // repudiation that never happened.
      voided:        r.voided === true,
    }));

    return { payments, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read contract payments.";
    // A read failure is usually the Soroban RPC being down rather than a bug
    // here, so it is a warning — but a countable one, since the UI silently
    // falls back to an empty list.
    logWarn("contract.read_payments_failed", {
      fields: { tripId, error: message },
    });
    return { payments: [], success: false, error: message };
  }
}

export async function checkIsPaid(
  callerPublicKey: string,
  expenseId: string,
  memberPublicKey: string
): Promise<IsPaidResult> {
  if (!contractReady("checkIsPaid")) {
    return { paid: false, success: false, error: "Contract not configured." };
  }

  try {
    const account  = await loadAccount(callerPublicKey);
    const contract = new Contract(CONTRACT_ID);

    const tx = new TransactionBuilder(account, {
      fee:              SOROBAN_BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        contract.call(
          "is_paid",
          nativeToScVal(expenseId,      { type: "string" }),
          new Address(memberPublicKey).toScVal()
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await sorobanServer.simulateTransaction(tx);

    if (
      rpc.Api.isSimulationError(simResult) ||
      !rpc.Api.isSimulationSuccess(simResult)
    ) {
      throw new Error("Simulation failed when checking payment status.");
    }

    const retval = simResult.result?.retval;
    const paid   = retval ? (scValToNative(retval) as boolean) : false;

    return { paid, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check on-chain payment status.";
    logWarn("contract.check_is_paid_failed", { fields: { expenseId, error: message } });
    return { paid: false, success: false, error: message };
  }
}
