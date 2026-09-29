/** @jest-environment jsdom */

const mockSelectedModule = {
  productId: "freighter",
  getAddress: jest.fn(),
};
const mockInit = jest.fn();
const mockSetWallet = jest.fn((id: string) => {
  mockSelectedModule.productId = id;
});
const mockAuthModal = jest.fn();
const mockGetAddress = jest.fn();
const mockGetNetwork = jest.fn();
const mockSignTransaction = jest.fn();

jest.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    init: mockInit,
    setWallet: mockSetWallet,
    authModal: mockAuthModal,
    getAddress: mockGetAddress,
    getNetwork: mockGetNetwork,
    signTransaction: mockSignTransaction,
    selectedModule: mockSelectedModule,
  },
}));
jest.mock("@creit.tech/stellar-wallets-kit/modules/freighter", () => ({
  FREIGHTER_ID: "freighter",
}));
jest.mock("@creit.tech/stellar-wallets-kit/modules/rabet", () => ({
  RABET_ID: "rabet",
}));
jest.mock("@creit.tech/stellar-wallets-kit/modules/xbull", () => ({
  XBULL_ID: "xbull",
}));
jest.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: jest.fn(() => []),
}));
jest.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  Networks: {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
  },
}));

import { getWalletsKit } from "@/lib/stellar/walletsKit";

describe("walletsKit adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedModule.productId = "freighter";
    delete (window as typeof window & { xBullSDK?: unknown }).xBullSDK;
    delete (window as typeof window & { rabet?: unknown }).rabet;
  });

  it("reads xBull's injected provider instead of using the app default", async () => {
    const getInjectedNetwork = jest.fn().mockResolvedValue({
      network: "TESTNET",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    (window as typeof window & { xBullSDK?: unknown }).xBullSDK = {
      getNetwork: getInjectedNetwork,
    };
    const kit = getWalletsKit();
    kit.setWallet("xbull");

    await expect(kit.getNetworkFromWallet()).resolves.toBe("TESTNET");
    expect(getInjectedNetwork).toHaveBeenCalledTimes(1);
    expect(mockGetNetwork).not.toHaveBeenCalled();
  });

  it("reads Rabet's active network from its injected API", async () => {
    (window as typeof window & { rabet?: unknown }).rabet = {
      getNetwork: jest.fn().mockResolvedValue({
        network: "MAINNET",
        passphrase: "Public Global Stellar Network ; September 2015",
      }),
    };
    const kit = getWalletsKit();
    kit.setWallet("rabet");

    await expect(kit.getNetworkFromWallet()).resolves.toBe("PUBLIC");
    expect(mockGetNetwork).not.toHaveBeenCalled();
  });

  it("reads and normalizes the selected wallet's network", async () => {
    mockGetNetwork.mockResolvedValue({
      network: "Mainnet",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    });

    const kit = getWalletsKit();
    kit.setWallet("freighter");

    await expect(kit.getNetworkFromWallet()).resolves.toBe("PUBLIC");
    expect(mockSetWallet).toHaveBeenCalledWith("freighter");
    expect(mockGetNetwork).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a wallet cannot report its network", async () => {
    mockGetNetwork.mockRejectedValue(new Error("getNetwork is not supported"));

    await expect(getWalletsKit().getNetworkFromWallet()).rejects.toThrow(
      "getNetwork is not supported",
    );
  });

  it("does not accept an unknown wallet network", async () => {
    mockGetNetwork.mockResolvedValue({
      network: "FUTURENET",
      networkPassphrase: "Test SDF Future Network ; October 2022",
    });

    await expect(getWalletsKit().getNetworkFromWallet()).rejects.toThrow(
      "unsupported Stellar network",
    );
  });

  it("reports the wallet selected by the upstream modal", async () => {
    mockAuthModal.mockImplementation(async () => {
      mockSelectedModule.productId = "lobstr";
      return { address: "GTESTADDRESS" };
    });
    const onWalletSelected = jest.fn();

    await getWalletsKit().openModal({ onWalletSelected });

    expect(onWalletSelected).toHaveBeenCalledWith({ id: "lobstr" });
  });
});
