/**
 * POST /api/payment/verify
 * GET  /api/payment/verify?txHash=...
 *
 * Verifies a transaction hash on the Stellar Horizon network before marking shares
 * paid, ensuring the transaction exists, succeeded on-chain, and optionally matches
 * recipient wallet details. Flags or rejects invalid/non-existent hashes.
 */
import { NextResponse } from "next/server";
import { verifyTransactionOnHorizon } from "@/lib/stellar/verifyPayment";
import { requestLogger, jsonWithCorrelation } from "@/lib/observability/requestLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const logger = requestLogger("POST /api/payment/verify", request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.finish("payment.verify_completed", 400, { reason: "malformed_json" });
    return jsonWithCorrelation(
      logger,
      { error: "A JSON body is required.", valid: false, flagged: true },
      { status: 400, headers: NO_STORE }
    );
  }

  const { txHash, destinationWallet, expectedAmount } = (body ?? {}) as {
    txHash?: unknown;
    destinationWallet?: unknown;
    expectedAmount?: unknown;
  };

  if (!txHash || typeof txHash !== "string") {
    logger.finish("payment.verify_completed", 400, { reason: "missing_tx_hash" });
    return jsonWithCorrelation(
      logger,
      { error: "Transaction hash is required.", valid: false, flagged: true },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await verifyTransactionOnHorizon(txHash, {
    destinationWallet: typeof destinationWallet === "string" ? destinationWallet : undefined,
    expectedAmount: typeof expectedAmount === "string" ? expectedAmount : undefined,
  });

  if (!result.exists) {
    logger.warn("payment.verify_not_found", { txHash, error: result.error });
    logger.finish("payment.verify_completed", 404);
    return jsonWithCorrelation(
      logger,
      result,
      { status: 404, headers: NO_STORE }
    );
  }

  if (result.flagged) {
    logger.warn("payment.verify_flagged", { txHash, error: result.error });
    logger.finish("payment.verify_completed", 200, { flagged: true });
    return jsonWithCorrelation(
      logger,
      result,
      { status: 200, headers: NO_STORE }
    );
  }

  logger.finish("payment.verify_completed", 200, { ledger: result.ledger });
  return jsonWithCorrelation(
    logger,
    result,
    { status: 200, headers: NO_STORE }
  );
}

export async function GET(request: Request) {
  const logger = requestLogger("GET /api/payment/verify", request);
  const url = new URL(request.url);
  const txHash = url.searchParams.get("txHash");
  const destinationWallet = url.searchParams.get("destinationWallet") || undefined;
  const expectedAmount = url.searchParams.get("expectedAmount") || undefined;

  if (!txHash) {
    logger.finish("payment.verify_completed", 400, { reason: "missing_tx_hash" });
    return jsonWithCorrelation(
      logger,
      { error: "Query parameter 'txHash' is required.", valid: false, flagged: true },
      { status: 400, headers: NO_STORE }
    );
  }

  const result = await verifyTransactionOnHorizon(txHash, {
    destinationWallet,
    expectedAmount,
  });

  if (!result.exists) {
    logger.warn("payment.verify_not_found", { txHash, error: result.error });
    logger.finish("payment.verify_completed", 404);
    return jsonWithCorrelation(
      logger,
      result,
      { status: 404, headers: NO_STORE }
    );
  }

  logger.finish("payment.verify_completed", 200, { ledger: result.ledger, flagged: result.flagged });
  return jsonWithCorrelation(
    logger,
    result,
    { status: 200, headers: NO_STORE }
  );
}
