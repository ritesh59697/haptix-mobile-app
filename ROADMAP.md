# Haptix Production Roadmap: Road to Live Wallet & Chrome Web Store

> **Haptix** is a Biometric Hardware Enclave Smart Account Layer for EVM (ERC-4337 v0.7 + WebAuthn P-256 RIP-7212), featuring un-drainable autonomous session policies, rolling spend windows, and zero seed phrases.

---

## Executive Summary & Current Status

- **Smart Contracts (`src/`)**: 100% complete, 243 passing tests across 17 test suites (Foundry). Includes Osaka RIP-7212 (`0x100`) precompile support, ERC-7562 validation invariants, multi-token rolling windows, and adversarial red-team test coverage.
- **SDK (`sdk/`)**: 100% complete, 50 passing Vitest unit/integration tests covering UserOp building, WebAuthn challenge verification, session key lifecycles, and social/hardware recovery.
- **Extension & Frontend (`extension/` & `extension-app/`)**: Functional Chrome Manifest V3 extension with sidepanel, popup, and inpage EIP-1193 bridge. Typescript type-checking passes cleanly.

---

## Phase 1: DApp Connectivity & Standard Compatibility (Completed)

- [x] **EIP-6963 Multi-Injected Provider Discovery**:
  - Implemented `eip6963:announceProvider` & `eip6963:requestProvider` in `extension/inpage.js` and `extension/content.js`.
  - Standard RDNS (`com.haptix.wallet`), UUID, wallet name (`Haptix`), and high-res vector monogram SVG icon.
  - Broadcasts `chainChanged` and `accountsChanged` events cleanly to dApps.
- [x] **ERC-1271 Off-Chain Signature Handling**:
  - Implemented `encode1271Signature(signerId, sig)` in `extension/userop.js` matching `PasskeyAccount.sol:isValidSignature(bytes32,bytes)`.
  - Added EIP-712 `getAccountMessageHash` querying the on-chain contract with fallback local computation.
  - Implemented decoded message display for `personal_sign` and `eth_signTypedData_v4` in the popup.
- [x] **Multi-Chain Network Switcher**:
  - Configured `NETWORKS` map in `extension/config.js` for Base Sepolia, Base Mainnet, Arbitrum One, Arbitrum Sepolia, Optimism, and OP Sepolia.
  - Added header Network Selector pill & dropdown in `extension/popup.html` and `extension/popup.js`.
  - Dynamic RPC routing and `wallet_switchEthereumChain` support in `extension/background.js`.

---

## Phase 2: Gasless Onboarding & Infrastructure (Mainnet Readiness) (Completed)

- [x] **Production Paymaster Integration**:
  - Implemented ERC-4337 v0.7 `pm_sponsorUserOperation` in `extension/userop.js` with Pimlico/Alchemy compatibility.
  - Automatically sponsors gas limits and paymasterData in `extension/popup.js`, with graceful fallback to standard UserOperations.
- [x] **Mainnet Contract Deployment & Verification Script**:
  - Created `script/DeployMainnet.s.sol` deploying `PasskeyAccount` implementation and `PasskeyAccountFactory` across Base Mainnet (`8453`), Arbitrum One (`42161`), and OP Mainnet (`10`).
  - Formatted automated `forge verify-contract` commands for Basescan, Arbiscan, and Optimistic Etherscan.
- [x] **Automated Account Initialization (`initCode`)**:
  - Implemented `buildAccountInitCode` and `ensureAccountInitCode` in `extension/userop.js`.
  - Automatically queries `eth_getCode` and prepends factory CREATE2 `createAccount` calldata (+250k verification gas) for counterfactual accounts.
- [x] **Chrome Extension Build & Package Pipeline**:
  - Configured `npm run package:extension` creating `dist/haptix-extension-v1.0.0.zip` ready for Chrome Web Store upload.

---

## Phase 3: UX, Backup & Key Management (Completed)

- [x] **Guided Passkey Redundancy (2-of-N Hardware Quorum)**:
  - Added "Hardware Passkeys & Enclave Quorum (2-of-N)" card in Settings.
  - Implemented "+ Register Backup Passkey" ceremony supporting biometric WebAuthn P-256 enrollment and multi-key storage.
  - Transparent quorum rules: micro-spends (< $50 / 0.01 ETH) use 1 passkey; larger spends, unapproved contracts, or freeze state require 2-of-2 dual hardware biometric quorum.
- [x] **Transaction Simulation & Security Breakdown**:
  - Calldata decoder identifying: Native ETH, ERC-20 transfers, **ERC-20 unlimited approvals** (`type(uint256).max` warning alert), DEX swaps, and custom contract calls.
  - Color-coded security badges: `🟢 1-Sig (Instant)`, `🟡 2-Sig (Quorum Required)`, and `🔴 Security Alert (Unlimited Approval)`.
  - 24h rolling spend window allocation progress bar integrated into both Send and dApp approval views.
  - Test Harness enhanced with Button #9 simulating unlimited approval security warnings.

---

## Phase 4: Chrome Web Store Submission & Distribution

- [ ] **Manifest & Permissions Audit**:
  - Verify minimal Chrome permissions (`storage`, `sidePanel`, `activeTab`).
  - Strip debugging endpoints and local test RPC secrets.
- [ ] **Store Listing Creative Assets**:
  - Icon set: 16x16, 48x48, 128x128.
  - Promotional tiles: Small promo (440x280), Large promo (920x680), Marquee promo (1400x560).
  - Screenshots (1280x800):
    1. *Biometric Zero-Seed-Phrase Login (FaceID / TouchID)*.
    2. *Un-drainable Wallet: Spend Limits & Autonomous Sessions*.
    3. *Instant Gasless Swaps & Account Abstraction*.
- [ ] **Hosted Companion PWA & Privacy Policy**:
  - Host landing page and web dashboard on production domain with HTTPS (required for WebAuthn RP ID).
  - Publish public `PRIVACY_POLICY.md` URL.
- [ ] **Chrome Web Store Submission**:
  - Build package via `npm run package:extension` -> upload zip to Chrome Developer Dashboard.

---

## Phase 5: Multi-Chain Expansion (Solana & Non-EVM)

- [ ] **Solana Architecture Study & Implementation**:
  - Implement `@solana/wallet-standard` in the extension (`window.solana`).
  - Leverage Solana's native `secp256r1_verify` precompile (SIMD-0075) to verify P-256 WebAuthn signatures on Solana program PDAs (Smart Accounts on Solana).
  - Unified multi-chain biometric wallet experience (EVM + SVM under one passkey).
