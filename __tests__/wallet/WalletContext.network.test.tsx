/** @jest-environment jsdom */

import React from "react";
import { WalletProvider, useWalletContext } from "@/context/WalletContext";

const { act, render, screen } = require("@testing-library/react");

const WALLET_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const mockSetWallet = jest.fn();
const mockGetAddress = jest.fn(async () => ({ address: WALLET_ADDRESS }));
const mockGetAddressSilently = jest.fn(async () => WALLET_ADDRESS);
const mockGetNetworkFromWallet = jest.fn<Promise<"TESTNET" | "PUBLIC">, []>();
const mockOpenModal = jest.fn(async (options: {
  onWalletSelected: (wallet: { id: string }) => Promise<void>;
}) => {
  await options.onWalletSelected({ id: "rabet" });
});

jest.mock("@/lib/stellar/walletsKit", () => ({
  FREIGHTER_ID: "freighter",
  getWalletsKit: () => ({
    setWallet: mockSetWallet,
    getAddress: mockGetAddress,
    getAddressSilently: mockGetAddressSilently,
    getNetworkFromWallet: mockGetNetworkFromWallet,
    openModal: mockOpenModal,
  }),
}));
jest.mock("@/lib/freighter", () => ({
  isFreighterInstalled: jest.fn(async () => true),
}));
jest.mock("@/lib/stellar/getBalance", () => ({
  getXLMBalance: jest.fn(async () => "10.0000000"),
}));
jest.mock("@/lib/supabase/session", () => ({
  clearWalletSession: jest.fn(),
}));
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  }),
}));

function Probe() {
  const {
    connect,
    network,
    networkStatus,
    isNetworkCompatible,
    selectedWalletId,
  } = useWalletContext();

  return (
    <div>
      <button type="button" onClick={() => void connect()}>Connect</button>
      <span data-testid="network">{network ?? "unknown"}</span>
      <span data-testid="status">{networkStatus}</span>
      <span data-testid="compatible">{String(isNetworkCompatible)}</span>
      <span data-testid="wallet-id">{selectedWalletId ?? "none"}</span>
    </div>
  );
}

describe("WalletProvider network reconciliation", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockGetNetworkFromWallet.mockResolvedValue("TESTNET");
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("checks the selected wallet after connect and detects a later mismatch", async () => {
    jest.useFakeTimers();
    const view = render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );

    await act(async () => {
      screen.getByRole("button", { name: "Connect" }).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("wallet-id").textContent).toBe("rabet");
    expect(screen.getByTestId("network").textContent).toBe("TESTNET");
    expect(screen.getByTestId("status").textContent).toBe("matched");
    expect(screen.getByTestId("compatible").textContent).toBe("true");
    expect(mockSetWallet).toHaveBeenCalledWith("rabet");

    mockGetNetworkFromWallet.mockResolvedValue("PUBLIC");
    await act(async () => {
      jest.advanceTimersByTime(5_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("network").textContent).toBe("PUBLIC");
    expect(screen.getByTestId("status").textContent).toBe("mismatched");
    expect(screen.getByTestId("compatible").textContent).toBe("false");
    view.unmount();
  });
});
