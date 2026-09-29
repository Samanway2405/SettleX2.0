# Wallet Integration

SettleX uses the maintained
[`@creit.tech/stellar-wallets-kit`](https://github.com/Creit-Tech/Stellar-Wallets-Kit)
package for wallet discovery, connection UI, address access, and transaction
signing.

The small adapter in
[`lib/stellar/walletsKit.ts`](../lib/stellar/walletsKit.ts) initializes the kit
once with its default modules and preserves the app-facing API used by
`WalletContext` and the transaction helpers. Wallet-specific behavior and the
accessible connection modal remain owned by the upstream package.

The npm distribution is used intentionally, so this project does not need a
JSR registry override in `.npmrc`.

## Default wallet support

`defaultModules()` enables the wallets that require no application-specific
configuration, including Freighter, Albedo, xBull, Lobstr, Rabet, Hana,
Klever, OneKey, Bitget, Fordefi, Cactus Link, D'CENT, Scopuly, MetaMask Stellar,
and Ghost.

The selected wallet ID is stored under `settlex:walletId`. On reload, SettleX
selects that module before reconciling the saved account, ensuring subsequent
signing requests go back to the wallet the user connected.



## Passkey smart wallets

For users without a Stellar wallet, a passkey-based Soroban smart wallet is a
separate onboarding path. See the product roadmap in
[`PRODUCT_CONVERSION_GUIDE.md`](./PRODUCT_CONVERSION_GUIDE.md).
