import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { FREIGHTER_ID as KIT_FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { RABET_ID } from "@creit.tech/stellar-wallets-kit/modules/rabet";
import { XBULL_ID } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import {
  NETWORK_PASSPHRASE,
  type StellarNetwork,
  normalizeStellarNetwork,
} from "@/lib/utils/constants";

export const FREIGHTER_ID = KIT_FREIGHTER_ID;
export type WalletId = string;

interface WalletModalOptions {
  onWalletSelected: (wallet: { id: WalletId }) => Promise<void> | void;
  onClosed?: () => void;
  modalTitle?: string;
  notAvailableText?: string;
}

let initialized = false;
let selectedWalletId: WalletId = FREIGHTER_ID;

function normalizeNetworkResponse(value: unknown): StellarNetwork | null {
  const direct = normalizeStellarNetwork(value);
  if (direct || !value || typeof value !== "object") return direct;

  const response = value as Record<string, unknown>;
  return (
    normalizeStellarNetwork(response.networkPassphrase) ??
    normalizeStellarNetwork(response.passphrase) ??
    normalizeStellarNetwork(response.network)
  );
}

async function readInjectedWalletNetwork(): Promise<StellarNetwork | null> {
  if (selectedWalletId === XBULL_ID) {
    const provider = (
      window as typeof window & {
        xBullSDK?: { getNetwork?: () => Promise<unknown> };
      }
    ).xBullSDK;
    if (provider?.getNetwork) {
      return normalizeNetworkResponse(await provider.getNetwork());
    }
  }

  if (selectedWalletId === RABET_ID) {
    const provider = (
      window as typeof window & {
        rabet?: { getNetwork?: () => Promise<unknown> };
      }
    ).rabet;
    if (provider?.getNetwork) {
      return normalizeNetworkResponse(await provider.getNetwork());
    }
  }

  return null;
}

function initializeKit(): void {
  if (initialized) return;

  StellarWalletsKit.init({
    modules: defaultModules(),
    selectedWalletId,
    network:
      NETWORK_PASSPHRASE === Networks.PUBLIC
        ? Networks.PUBLIC
        : Networks.TESTNET,
    authModal: {
      showInstallLabel: true,
      hideUnsupportedWallets: false,
    },
  });
  initialized = true;
}

/**
 * Small adapter around the v2 static API. Network reads deliberately delegate
 * to the selected wallet module and never substitute the app's configured
 * network: an unavailable read must remain "unverified" so callers fail
 * closed instead of presenting a false match.
 */
const walletsKit = {
  setWallet(id: WalletId): void {
    StellarWalletsKit.setWallet(id);
    selectedWalletId = id;
  },

  getSelectedWalletId(): WalletId {
    return selectedWalletId;
  },

  async openModal(opts: WalletModalOptions): Promise<void> {
    try {
      await StellarWalletsKit.authModal();
      selectedWalletId = StellarWalletsKit.selectedModule.productId;
      await opts.onWalletSelected({ id: selectedWalletId });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error && "message" in error
            ? String(error.message)
            : "";

      if (/closed|cancel/i.test(message)) {
        opts.onClosed?.();
        return;
      }
      throw error;
    }
  },

  getAddress(): Promise<{ address: string }> {
    return StellarWalletsKit.getAddress();
  },

  async getAddressSilently(): Promise<string | null> {
    // Only Freighter implements the kit's skipRequestAccess option. Calling
    // other modules here can open a connection prompt during background polling.
    if (selectedWalletId !== FREIGHTER_ID) return null;

    try {
      const { address } = await StellarWalletsKit.selectedModule.getAddress({
        skipRequestAccess: true,
      });
      return address || null;
    } catch {
      return null;
    }
  },

  signTransaction(
    xdr: string,
    options: { address: string; networkPassphrase?: string },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    return StellarWalletsKit.signTransaction(xdr, options);
  },

  async getNetworkFromWallet(): Promise<StellarNetwork> {
    // The current kit adapters omit getNetwork for xBull and Rabet even though
    // their injected providers expose it, so read those providers directly.
    const injectedNetwork = await readInjectedWalletNetwork();
    if (injectedNetwork) return injectedNetwork;

    const result = await StellarWalletsKit.getNetwork();
    const network = normalizeNetworkResponse(result);

    if (!network) {
      throw new Error("The selected wallet returned an unsupported Stellar network.");
    }
    return network;
  },
};

export function getWalletsKit(): typeof walletsKit {
  if (typeof window === "undefined") {
    throw new Error("StellarWalletsKit requires a browser environment.");
  }

  initializeKit();
  return walletsKit;
}
