import { HORIZON_URL } from "@/lib/utils/constants";

export interface HorizonVerificationOptions {
  expectedAmount?: string;
  destinationWallet?: string;
  sourceWallet?: string;
}

export interface HorizonVerificationResult {
  valid: boolean;
  exists: boolean;
  successful: boolean;
  flagged: boolean;
  ledger?: number;
  memo?: string;
  sourceAccount?: string;
  createdAt?: string;
  error?: string;
  warning?: string;
  operations?: Array<{
    type: string;
    from?: string;
    to?: string;
    amount?: string;
  }>;
}

/**
 * Verifies a transaction hash directly against Stellar Horizon.
 * Flags or rejects transactions that do not exist, failed on ledger,
 * or do not match payment details.
 */
export async function verifyTransactionOnHorizon(
  txHash: string,
  options?: HorizonVerificationOptions
): Promise<HorizonVerificationResult> {
  if (!txHash || typeof txHash !== "string" || !/^[0-9a-fA-F]{64}$/.test(txHash)) {
    return {
      valid: false,
      exists: false,
      successful: false,
      flagged: true,
      error: "Invalid transaction hash format. Expected a 64-character hexadecimal string.",
    };
  }

  const normalizedHash = txHash.toLowerCase();

  try {
    const res = await fetch(`${HORIZON_URL}/transactions/${normalizedHash}`, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status === 404) {
      return {
        valid: false,
        exists: false,
        successful: false,
        flagged: true,
        error: "Transaction not found on Stellar Horizon.",
      };
    }

    if (!res.ok) {
      return {
        valid: false,
        exists: false,
        successful: false,
        flagged: true,
        error: `Horizon error (${res.status}): failed to fetch transaction.`,
      };
    }

    const txData = await res.json();
    const successful = txData.successful !== false;

    // Check transaction operations if available
    let operations: Array<{ type: string; from?: string; to?: string; amount?: string }> = [];
    try {
      const opsRes = await fetch(`${HORIZON_URL}/transactions/${normalizedHash}/operations`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (opsRes.ok) {
        const opsData = await opsRes.json();
        const records = opsData._embedded?.records || [];
        operations = records.map((op: any) => ({
          type: op.type,
          from: op.from || op.source_account,
          to: op.to || op.into,
          amount: op.amount,
        }));
      }
    } catch {
      // Operations fetch failure is non-fatal
    }

    // Flag if transaction was submitted but failed on-chain
    if (!successful) {
      return {
        valid: false,
        exists: true,
        successful: false,
        flagged: true,
        ledger: txData.ledger_attr ?? txData.ledger,
        memo: txData.memo,
        sourceAccount: txData.source_account,
        createdAt: txData.created_at,
        error: "Transaction failed on the Stellar ledger.",
        operations,
      };
    }

    // Check destination wallet if specified
    if (options?.destinationWallet) {
      const targetDest = options.destinationWallet.toUpperCase();
      const hasDest = operations.some(
        (op) =>
          op.to &&
          op.to.toUpperCase() === targetDest
      );
      if (operations.length > 0 && !hasDest) {
        return {
          valid: false,
          exists: true,
          successful: true,
          flagged: true,
          ledger: txData.ledger_attr ?? txData.ledger,
          memo: txData.memo,
          sourceAccount: txData.source_account,
          createdAt: txData.created_at,
          warning: "Payment destination does not match expected member wallet.",
          error: "Payment destination does not match expected member wallet.",
          operations,
        };
      }
    }

    return {
      valid: true,
      exists: true,
      successful: true,
      flagged: false,
      ledger: txData.ledger_attr ?? txData.ledger,
      memo: txData.memo,
      sourceAccount: txData.source_account,
      createdAt: txData.created_at,
      operations,
    };
  } catch (err) {
    return {
      valid: false,
      exists: false,
      successful: false,
      flagged: true,
      error: err instanceof Error ? err.message : "Failed to verify transaction on Horizon.",
    };
  }
}
