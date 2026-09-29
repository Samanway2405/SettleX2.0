import {
  normalizeStellarNetwork,
  stellarNetworkLabel,
} from "@/lib/utils/constants";

describe("Stellar network normalization", () => {
  it.each([
    ["PUBLIC", "PUBLIC"],
    ["mainnet", "PUBLIC"],
    ["Public Global Stellar Network ; September 2015", "PUBLIC"],
    ["TESTNET", "TESTNET"],
    ["Test SDF Network ; September 2015", "TESTNET"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeStellarNetwork(input)).toBe(expected);
  });

  it("returns null rather than guessing for an unsupported network", () => {
    expect(normalizeStellarNetwork("FUTURENET")).toBeNull();
    expect(normalizeStellarNetwork(undefined)).toBeNull();
  });

  it("uses user-facing labels", () => {
    expect(stellarNetworkLabel("PUBLIC")).toBe("Mainnet");
    expect(stellarNetworkLabel("TESTNET")).toBe("Testnet");
  });
});
