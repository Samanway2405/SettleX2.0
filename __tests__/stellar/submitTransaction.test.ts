const submitTransactionMock = jest.fn();
const transactionLookupMock = jest.fn();
const fromXdrMock = jest.fn();

jest.mock("@/lib/stellar/client", () => ({
  server: {
    submitTransaction: (...args: unknown[]) => submitTransactionMock(...args),
    transactions: () => ({
      transaction: (...args: unknown[]) => ({
        call: () => transactionLookupMock(...args),
      }),
    }),
  },
}));

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    TransactionBuilder: {
      ...actual.TransactionBuilder,
      fromXDR: (...args: unknown[]) => fromXdrMock(...args),
    },
  };
});

import { submitSignedTransaction } from "@/lib/stellar/submitTransaction";

describe("submitSignedTransaction", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    fromXdrMock.mockReturnValue({
      id: "tx",
      hash: () => Buffer.from("mocked_tx_hash_123456", "utf-8"),
    });
  });

  it("returns successful submit result", async () => {
    submitTransactionMock.mockResolvedValue({ hash: "abc", ledger: 99 });

    const res = await submitSignedTransaction("SIGNED_XDR");

    expect(fromXdrMock).toHaveBeenCalled();
    expect(submitTransactionMock).toHaveBeenCalled();
    expect(res).toEqual({ hash: "abc", ledger: 99, successful: true });
  });

  it("maps operation errors to friendly messages", async () => {
    submitTransactionMock.mockRejectedValue({
      response: {
        data: {
          extras: {
            result_codes: {
              transaction: "tx_failed",
              operations: ["op_no_destination"],
            },
          },
        },
      },
    });

    await expect(submitSignedTransaction("SIGNED_XDR")).rejects.toThrow(
      "The recipient account doesn't exist on the Stellar network.",
    );
  });

  it("recovers and returns success when Horizon times out (504) but transaction is found on ledger", async () => {
    submitTransactionMock.mockRejectedValue({
      response: {
        status: 504,
        data: {
          title: "Timeout",
        },
      },
    });

    transactionLookupMock.mockResolvedValueOnce({
      hash: "mocked_tx_hash_123456",
      ledger_attr: 150,
      successful: true,
    });

    const res = await submitSignedTransaction("SIGNED_XDR", {
      maxPollWaitMs: 100,
      pollIntervalMs: 10,
    });

    expect(res).toEqual({
      hash: "mocked_tx_hash_123456",
      ledger: 150,
      successful: true,
    });
  });

  it("maps tx_bad_seq errors if not found on chain", async () => {
    submitTransactionMock.mockRejectedValue({
      response: {
        data: {
          extras: {
            result_codes: {
              transaction: "tx_bad_seq",
              operations: ["op_success"],
            },
          },
        },
      },
    });

    transactionLookupMock.mockRejectedValue({
      response: { status: 404 },
    });

    await expect(
      submitSignedTransaction("SIGNED_XDR", {
        maxPollWaitMs: 50,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow("Transaction sequence mismatch. Please try again.");
  });

  it("returns actionable timeout message for indeterminate timeout if not confirmed after polling", async () => {
    submitTransactionMock.mockRejectedValue({
      response: {
        status: 504,
      },
    });

    transactionLookupMock.mockRejectedValue({
      response: { status: 404 },
    });

    await expect(
      submitSignedTransaction("SIGNED_XDR", {
        maxPollWaitMs: 50,
        pollIntervalMs: 10,
      })
    ).rejects.toThrow(/Transaction submission timed out/);
    expect(transactionLookupMock).toHaveBeenCalled();
  });
});
