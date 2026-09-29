export type StellarNetwork = "TESTNET" | "PUBLIC";

export const STELLAR_NETWORK =
  (process.env.NEXT_PUBLIC_STELLAR_NETWORK as StellarNetwork) ?? "TESTNET";

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const STELLAR_EXPLORER =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER ??
  "https://stellar.expert/explorer/testnet";

export const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === "PUBLIC"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";

/** Normalizes wallet labels and passphrases without guessing a default. */
export function normalizeStellarNetwork(value: unknown): StellarNetwork | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (
    normalized === "public" ||
    normalized === "mainnet" ||
    normalized === "pubnet" ||
    normalized === "public global stellar network ; september 2015"
  ) {
    return "PUBLIC";
  }
  if (
    normalized === "testnet" ||
    normalized === "test" ||
    normalized === "test sdf network ; september 2015"
  ) {
    return "TESTNET";
  }
  return null;
}

export function stellarNetworkLabel(network: StellarNetwork): string {
  return network === "PUBLIC" ? "Mainnet" : "Testnet";
}

export const MEMO_PREFIX        = "SettleX";
export const TX_BASE_FEE        = 100;
export const TX_TIMEOUT_SECONDS = 180;
export const TX_MAX_FEE_STROOPS = 10_000;
export const MEMO_MAX_BYTES     = 28;

export const LS_PUBLIC_KEY = "settlex:publicKey";
export const LS_WALLET_ID  = "settlex:walletId";
export const LS_EXPENSES   = "settlex:expenses";
export const LS_TRIPS      = "settlex:trips";
export const LS_USER       = "settlex:user";

export function getWalletScopedKey(baseKey: string, walletAddress?: string | null) {
  return walletAddress ? `${baseKey}:${walletAddress}` : baseKey;
}

export function clearAppCaches(walletAddress?: string | null) {
  if (typeof window === "undefined") return;

  const keys = new Set<string>([
    LS_USER,
    LS_EXPENSES,
    LS_TRIPS,
    walletAddress ? getWalletScopedKey(LS_USER, walletAddress) : null,
    walletAddress ? getWalletScopedKey(LS_EXPENSES, walletAddress) : null,
    walletAddress ? getWalletScopedKey(LS_TRIPS, walletAddress) : null,
  ].filter((value): value is string => !!value));

  try {
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }

    const staleKeys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (
        key.startsWith(`${LS_USER}:`) ||
        key.startsWith(`${LS_EXPENSES}:`) ||
        key.startsWith(`${LS_TRIPS}:`)
      ) {
        staleKeys.push(key);
      }
    }

    for (const key of staleKeys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Private mode can reject storage mutations; the app still clears in-memory state.
  }
}

export const APP_NAME    = process.env.NEXT_PUBLIC_APP_NAME    ?? "SettleX";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0";

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";

export const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
