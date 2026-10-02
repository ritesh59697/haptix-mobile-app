# EVM phone app

Same Haptix idea on an EVM chain: a passkey instead of a seed phrase, a second device for anything over the spend limit, a guardian who can freeze and start recovery but cannot spend, and an agent key with its own budget.

Not a port of the Solana program. The account is already this repo.

## Already built

- `src/PasskeyAccount.sol` and `src/PasskeyAccountFactory.sol`
- ERC-4337 v0.7. EntryPoint `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- P-256 check is the `0x100` precompile (RIP-7212)
- Web demo and extension already submit user operations (`web/userop.js`, `web/app.html`)
- Deployments are in the root `README.md`: Base Sepolia, Arbitrum Sepolia, Arc testnet

The Expo app under `solana-mobile/haptix-mobile-app` speaks Solana only. That is the missing piece.

## What the phone has to do

Replace the Solana client, not the screens. A send is a user operation: the phone builds it, a bundler submits it, a paymaster pays gas. The passkey signs the userOp hash. A signature made for the Solana wallet cannot move this account, even if both use the same fingerprint.

Rough effort for one person, using the screens that already exist:

- One testnet: create the account, show the balance, send under the limit. About two weeks.
- Match the Solana app: Mac second-key prompt, recovery, spend limits, agent grants. About a month.
- Mainnet: another couple of weeks. The new piece is the paymaster.

## Do not repeat

- The paymaster is the fee payer. It is not the guardian, and its key does not ship inside the app.
- A zero recovery delay makes the guardian an instant spender. The form already rejects that on Solana. Keep it rejected here.
- One recovery at a time. Starting it again must not reset the clock.
- The amount and the recipient on screen are the bytes being signed. An unrecognized payload does not get a fingerprint.
- Upgrade authority on a mainnet deployment is a timelocked multisig or revoked. A laptop key that can replace the account is the real backend.

## First chain

Base Sepolia. The account, the factory, and a live passkey send are already there. Add chains only after that phone path works.
