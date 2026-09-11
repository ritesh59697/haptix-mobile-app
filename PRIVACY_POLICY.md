# Privacy Policy for Haptix — Biometric Passkey Wallet

**Last Updated:** September 3, 2026

## 1. Overview
Haptix ("we", "our", or "the Extension") is a non-custodial Web3 smart contract wallet extension powered by ERC-4337 and WebAuthn hardware passkeys. We respect your privacy and are committed to protecting your personal information.

## 2. Information We Collect
**Haptix collects ZERO personal data, analytics, or telemetry.**

- **No Personal Identifiers:** We do not collect names, email addresses, phone numbers, IP addresses, or physical locations.
- **No Keystroke or Activity Tracking:** We do not track your browsing history or your interactions on websites.
- **No Private Keys or Biometric Data:** Passkey private keys are generated and stored exclusively within your physical device's secure hardware enclave (e.g. Apple Secure Enclave, Android Keystore, Windows Hello, YubiKey). Biometric data (fingerprint or face) never leaves your device and is never accessible to the extension, smart contracts, or any server.

## 3. Local Storage Usage
The Extension stores strictly operational preferences locally in your browser's `chrome.storage.local`:
- Enrolled public keys (P-256 public coordinates $x, y$)
- Configured smart account addresses
- Network preferences (e.g. Base Sepolia, Base Mainnet)
- Session token thresholds and spending policy configurations

This data remains stored locally on your device and is never uploaded to any centralized server.

## 4. Network Requests & Third Parties
When you initiate an on-chain operation or view account balances, the extension communicates with:
- **Public Blockchain RPC Providers:** To read account balances and broadcast signed ERC-4337 UserOperations to public bundlers (e.g. Base Sepolia RPC, Pimlico, Alchemy).
- **Public Decentralized Oracles / Price APIs:** To fetch token exchange rates (e.g. CoinGecko or Pyth benchmarks).

These requests do not contain personal information.

## 5. Security of Your Data
Haptix is non-custodial. All operations are governed directly by open-source smart contracts deployed on Ethereum Virtual Machine (EVM) networks. You maintain complete control over your account.

## 6. Children's Privacy
Haptix is not directed to individuals under the age of 18. We do not knowingly collect personal data from children.

## 7. Open Source & Verifiability
The entire source code of Haptix, including its smart contracts, extension, and SDK, is open source and available for public audit at:
[https://github.com/ritesh59697/haptix](https://github.com/ritesh59697/haptix)

## 8. Contact
If you have questions about this Privacy Policy, please open an issue on our GitHub repository:
[https://github.com/ritesh59697/haptix/issues](https://github.com/ritesh59697/haptix/issues)
