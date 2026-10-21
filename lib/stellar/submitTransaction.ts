import { TransactionBuilder } from "@stellar/stellar-sdk";
import { server } from "./client";
import { HORIZON_URL, NETWORK_PASSPHRASE } from "@/lib/utils/constants";
import type { StellarSubmitResult, HorizonErrorResponse } from "@/types/stellar";

export type { StellarSubmitResult };

function friendlyOpError(code: string): string {
  const map: Record<string, string> = {
    op_underfunded:          "Insufficient XLM balance to complete this payment.",
    op_insufficient_balance: "Insufficient XLM balance to complete this payment.",
    op_no_destination:       "The recipient account doesn't exist on the Stellar network.",
    op_no_trust:             "The recipient hasn't set up a trustline for this asset.",
    op_line_full:            "The recipient's account cannot receive more of this asset.",
    op_not_authorized:       "You are not authorised to send to this account.",
    op_malformed:            "Transaction is malformed — check the amount and addresses.",
  };
  return map[code] ?? `Operation failed: ${code}`;
}

export function extractTxHash(tx: any): string {
  try {
    if (typeof tx?.hash === "function") {
      const h = tx.hash();
      return typeof h === "string" ? h : h?.toString("hex") || "";
    }
  } catch {
    // Ignore extraction failure
  }
  return "";
}

export async function pollTransactionByHash(
  txHash: string,
  maxWaitMs = 25000,
  intervalMs = 2000
): Promise<StellarSubmitResult | null> {
  if (!txHash) return null;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      if (typeof server?.transactions === "function" && typeof server.transactions().transaction === "function") {
        const txRecord = await server.transactions().transaction(txHash).call();
        if (txRecord && txRecord.successful !== false) {
          return {
            hash: txRecord.hash || txHash,
            ledger: (txRecord as any).ledger_attr ?? (txRecord as any).ledger ?? 0,
            successful: true,
          };
        } else if (txRecord && txRecord.successful === false) {
          throw new Error("Transaction was included in a ledger but failed on-chain.");
        }
      } else {
        const res = await fetch(`${HORIZON_URL}/transactions/${txHash}?_ts=${Date.now()}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const txRecord = await res.json();
          if (txRecord && txRecord.successful !== false) {
            return {
              hash: txRecord.hash || txHash,
              ledger: txRecord.ledger_attr ?? txRecord.ledger ?? 0,
              successful: true,
            };
          }
        }
      }
    } catch (err: any) {
      if (err?.message?.includes("included in a ledger but failed")) {
        throw err;
      }
      // 404 means transaction has not been included in a closed ledger yet — continue polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  return null;
}

function isDefinitiveFailure(err: unknown): { isDefinitive: boolean; message?: string } {
  const horizonErr = err as {
    response?: {
      status?: number;
      data?: HorizonErrorResponse;
    };
    status?: number;
  };

  const status = horizonErr?.response?.status ?? horizonErr?.status;
  const extras = horizonErr?.response?.data?.extras;

  // 504 Timeout, 502 Bad Gateway, 503 Service Unavailable, network aborts are indeterminate
  if (status === 504 || status === 502 || status === 503 || status === 500) {
    return { isDefinitive: false };
  }

  if (extras?.result_codes) {
    const { transaction, operations } = extras.result_codes;
    const opCode = operations?.[0];

    if (opCode && opCode !== "op_success") {
      return { isDefinitive: true, message: friendlyOpError(opCode) };
    }

    if (transaction === "tx_insufficient_fee") {
      return { isDefinitive: true, message: "Transaction fee too low for current network conditions. Please try again." };
    }
    if (transaction === "tx_bad_auth" || transaction === "tx_bad_auth_extra") {
      return { isDefinitive: true, message: "Transaction signature is invalid." };
    }
    if (transaction === "tx_too_late") {
      return { isDefinitive: true, message: "Transaction expired before being included in a ledger. Please try again." };
    }
    if (transaction === "tx_too_early") {
      return { isDefinitive: true, message: "Transaction time bound is in the future." };
    }
    if (transaction === "tx_no_source_account") {
      return { isDefinitive: true, message: "Source account does not exist." };
    }
    if (transaction === "tx_insufficient_balance") {
      return { isDefinitive: true, message: "Insufficient XLM balance to pay transaction fees." };
    }

    // tx_bad_seq can happen if the transaction was already submitted and processed during a timeout retry
    if (transaction === "tx_bad_seq") {
      return { isDefinitive: false, message: "Transaction sequence mismatch. Please try again." };
    }

    if (transaction && transaction !== "tx_success" && transaction !== "tx_timeout") {
      return { isDefinitive: true, message: `Transaction failed: ${transaction}` };
    }
  }

  // Network exceptions, fetch errors, timeouts without response are indeterminate
  return { isDefinitive: false };
}

export async function submitSignedTransaction(
  signedXDR: string,
  options?: { maxPollWaitMs?: number; pollIntervalMs?: number }
): Promise<StellarSubmitResult> {
  const tx = TransactionBuilder.fromXDR(signedXDR, NETWORK_PASSPHRASE);
  const txHash = extractTxHash(tx);

  try {
    const response = await server.submitTransaction(tx);
    return {
      hash: response.hash || txHash,
      ledger: response.ledger,
      successful: true,
    };
  } catch (err: unknown) {
    const check = isDefinitiveFailure(err);

    // If it's a known deterministic failure, fail immediately
    if (check.isDefinitive && check.message) {
      throw new Error(check.message);
    }

    // On indeterminate failures (504 timeout, network drops, 502/503, or tx_bad_seq race),
    // poll Horizon by hash before failing to ensure we do not report false negatives
    if (txHash) {
      const pollResult = await pollTransactionByHash(
        txHash,
        options?.maxPollWaitMs ?? 25000,
        options?.pollIntervalMs ?? 2000
      );

      if (pollResult && pollResult.successful) {
        return pollResult;
      }
    }

    // If tx_bad_seq was reported and hash polling didn't find it, report bad sequence error
    if (check.message) {
      throw new Error(check.message);
    }

    // Otherwise, if indeterminate and not confirmed after polling, provide an actionable warning
    throw new Error(
      "Transaction submission timed out. The network might still be processing your transaction. " +
      "Please check your transaction history or wait a moment before trying again to avoid duplicate payments."
    );
  }
}
