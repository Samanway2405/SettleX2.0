/** @jest-environment jsdom */

import { buildPaymentTransaction } from "@/lib/stellar/buildTransaction";
import { submitSignedTransaction } from "@/lib/stellar/submitTransaction";
import { checkIsPaid, precheckPoolBalance, recordPaymentOnChain } from "@/lib/stellar/contract";
import { signXDR } from "@/lib/freighter";
import type { SplitShare } from "@/types/expense";

const { act, renderHook, waitFor } = require("@testing-library/react");

jest.mock("@/lib/stellar/buildTransaction");
jest.mock("@/lib/stellar/submitTransaction");
jest.mock("@/lib/stellar/contract");
jest.mock("@/lib/freighter");
jest.mock("@/hooks/useWallet", () => ({
  useWallet: jest.fn(),
}));
jest.mock("@/hooks/useExpense", () => ({
  useExpense: jest.fn(),
}));
jest.mock("@/components/ui/Toast", () => ({
  useToast: jest.fn(),
}));

describe("usePayment integration flow", () => {
  const { usePayment } = require("@/hooks/usePayment") as typeof import("@/hooks/usePayment");
  const mockedUseWallet = (jest.requireMock("@/hooks/useWallet") as { useWallet: jest.Mock }).useWallet;
  const mockedUseExpense = (jest.requireMock("@/hooks/useExpense") as { useExpense: jest.Mock }).useExpense;
  const mockedUseToast = (jest.requireMock("@/components/ui/Toast") as { useToast: jest.Mock }).useToast;

  const mockRefreshBalance = jest.fn();
  const mockRefreshNetwork = jest.fn(async () => "TESTNET");
  const mockMarkSharePaid = jest.fn(async (_expenseId: string, _memberId: string, _txHash: string) => {});
  const mockToastSuccess = jest.fn();
  const mockToastError = jest.fn();
  const mockToastInfo = jest.fn();

  const share: SplitShare = {
    memberId: "member-1",
    name: "Bob",
    walletAddress: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    amount: "1.5000000",
    paid: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockedUseWallet.mockReturnValue({
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      refreshBalance: mockRefreshBalance,
      refreshNetwork: mockRefreshNetwork,
      isNetworkCompatible: true,
      networkStatus: "matched",
      expectedNetwork: "TESTNET",
    });

    mockedUseExpense.mockReturnValue({
      markSharePaid: mockMarkSharePaid,
    });

    mockedUseToast.mockReturnValue({
      success: mockToastSuccess,
      error: mockToastError,
      info: mockToastInfo,
    });

    jest.mocked(buildPaymentTransaction).mockResolvedValue({ xdr: "unsigned-xdr", memo: "SettleX|Dinner" });
    jest.mocked(signXDR).mockResolvedValue("signed-xdr");
    jest.mocked(submitSignedTransaction).mockResolvedValue({
      hash: "tx-hash-123",
      ledger: 321,
      successful: true,
    });
    jest.mocked(checkIsPaid).mockResolvedValue({ paid: false, success: true });
    jest.mocked(precheckPoolBalance).mockResolvedValue({
      ok: true,
      requiredStroops: 15000000n,
      balanceStroops: 15000000n,
    });
    jest.mocked(recordPaymentOnChain).mockResolvedValue({ success: true, ledger: 322 });
  });

  it("completes payment and records on-chain successfully", async () => {
    const { result } = renderHook(() => usePayment({ expenseId: "exp-1" }));

    await act(async () => {
      await result.current.payShare({
        share,
        expenseTitle: "Dinner",
        payerWalletAddress: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
        tripId: "trip-1",
      });
    });

    await waitFor(() => {
      expect(result.current.paymentState.status).toBe("success");
    });

    expect(mockMarkSharePaid).toHaveBeenCalledWith("exp-1", "member-1", "tx-hash-123");
    expect(recordPaymentOnChain).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  it("does not build or submit a payment when the wallet network mismatches", async () => {
    mockedUseWallet.mockReturnValue({
      publicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      refreshBalance: mockRefreshBalance,
      refreshNetwork: jest.fn(async () => "PUBLIC"),
      isNetworkCompatible: false,
      networkStatus: "mismatched",
      expectedNetwork: "TESTNET",
    });
    const { result } = renderHook(() => usePayment({ expenseId: "exp-network" }));

    await act(async () => {
      await result.current.payShare({
        share,
        expenseTitle: "Dinner",
        payerWalletAddress: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      });
    });

    expect(buildPaymentTransaction).not.toHaveBeenCalled();
    expect(signXDR).not.toHaveBeenCalled();
    expect(submitSignedTransaction).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      "Payment blocked",
      "Switch your wallet to Testnet before paying.",
    );
  });

  it("supports retry when on-chain recording initially fails", async () => {
    jest.mocked(recordPaymentOnChain)
      .mockResolvedValueOnce({ success: false, error: "Pool balance too low" })
      .mockResolvedValueOnce({ success: true, ledger: 400 });

    const { result } = renderHook(() => usePayment({ expenseId: "exp-2" }));

    await act(async () => {
      await result.current.payShare({
        share,
        expenseTitle: "Taxi",
        payerWalletAddress: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
        tripId: "trip-2",
      });
    });

    await waitFor(() => {
      expect(result.current.paymentState.status).toBe("partial_success");
    });

    await act(async () => {
      await result.current.retryOnChainRecord();
    });

    await waitFor(() => {
      expect(result.current.paymentState.status).toBe("success");
    });

    expect(recordPaymentOnChain).toHaveBeenCalledTimes(2);
  });
});
