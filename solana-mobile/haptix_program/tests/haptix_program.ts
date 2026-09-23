import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";
import { HaptixProgram } from "../target/types/haptix_program";

describe("haptix_program tests", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.haptixProgram as Program<HaptixProgram>;

  // Mock 33-byte compressed secp256r1 passkey public keys
  const primaryPasskey = Buffer.alloc(33, 0x02);
  primaryPasskey[1] = 0xAA; // Distinct byte

  const secondaryPasskey = Buffer.alloc(33, 0x03);
  secondaryPasskey[1] = 0xBB; // Distinct byte

  const guardianKeypair = Keypair.generate();

  let walletPda: PublicKey;
  let walletBump: number;

  before(async () => {
    [walletPda, walletBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("haptix_wallet"), primaryPasskey.subarray(1, 33)],
      program.programId
    );

    // Fund the guardian for gas
    const airdropSig = await provider.connection.requestAirdrop(
      guardianKeypair.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    const latestBlockhash = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction({
      signature: airdropSig,
      ...latestBlockhash,
    });
  });

  it("Initializes a Haptix Passkey Account", async () => {
    const tx = await program.methods
      .initializeWallet(
        Array.from(primaryPasskey),
        Array.from(secondaryPasskey),
        new anchor.BN(100_000_000), // 0.1 SOL spend threshold
        guardianKeypair.publicKey,
        null // default recovery timelock
      )
      .accounts({
        payer: provider.wallet.publicKey,
        wallet: walletPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("Wallet initialized. Tx:", tx);

    const walletAccount = await program.account.walletAccount.fetch(walletPda);
    assert.deepEqual(Buffer.from(walletAccount.primaryPasskey), primaryPasskey);
    assert.deepEqual(Buffer.from(walletAccount.secondaryPasskey), secondaryPasskey);
    assert.equal(walletAccount.spendThresholdLamports.toNumber(), 100_000_000);
    assert.equal(walletAccount.guardian.toBase58(), guardianKeypair.publicKey.toBase58());
    assert.equal(walletAccount.isFrozen, false);
    assert.equal(walletAccount.agents.length, 0);
    assert.equal(walletAccount.recoveryTimelock.toNumber(), 86_400);
  });

  it("Guardian triggers Panic Freeze", async () => {
    const tx = await program.methods
      .panicFreeze()
      .accounts({
        wallet: walletPda,
        signer: guardianKeypair.publicKey,
      })
      .signers([guardianKeypair])
      .rpc();

    console.log("Wallet panic frozen. Tx:", tx);

    const walletAccount = await program.account.walletAccount.fetch(walletPda);
    assert.equal(walletAccount.isFrozen, true);
  });

  it("Guardian initiates Social Recovery", async () => {
    const newPrimary = Buffer.alloc(33, 0x02);
    newPrimary[1] = 0xCC;
    const newSecondary = Buffer.alloc(33, 0x03);
    newSecondary[1] = 0xDD;

    const tx = await program.methods
      .initiateRecovery(Array.from(newPrimary), Array.from(newSecondary))
      .accounts({
        wallet: walletPda,
        guardian: guardianKeypair.publicKey,
      })
      .signers([guardianKeypair])
      .rpc();

    console.log("Recovery initiated. Tx:", tx);

    const walletAccount = await program.account.walletAccount.fetch(walletPda);
    assert.isTrue(walletAccount.recoveryInitiatedAt.toNumber() > 0);
    assert.deepEqual(Buffer.from(walletAccount.pendingPrimaryPasskey), newPrimary);
    assert.deepEqual(Buffer.from(walletAccount.pendingSecondaryPasskey), newSecondary);
  });

  it("Refuses to execute recovery before the timelock elapses", async () => {
    // This wallet carries the 24h default, so the window cannot have passed.
    try {
      await program.methods.executeRecovery().accounts({ wallet: walletPda }).rpc();
      assert.fail("execute_recovery should have been rejected");
    } catch (err: any) {
      assert.include(String(err), "RecoveryTimelockNotElapsed");
    }

    const walletAccount = await program.account.walletAccount.fetch(walletPda);
    assert.deepEqual(Buffer.from(walletAccount.primaryPasskey), primaryPasskey);
    assert.equal(walletAccount.isFrozen, true);
  });

  it("Executes recovery once the timelock elapses and rotates the keys", async () => {
    // A second wallet on a two-second timelock. Waiting out the 24h default is not an
    // option in a test, and shortening the window is the only way to reach the branch
    // that actually swaps the keys -- the half of recovery that was never covered.
    const shortPrimary = Buffer.alloc(33, 0x02);
    shortPrimary[1] = 0x11;
    const shortSecondary = Buffer.alloc(33, 0x03);
    shortSecondary[1] = 0x22;

    const [shortPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("haptix_wallet"), shortPrimary.subarray(1, 33)],
      program.programId
    );

    await program.methods
      .initializeWallet(
        Array.from(shortPrimary),
        Array.from(shortSecondary),
        null,
        guardianKeypair.publicKey,
        new anchor.BN(2)
      )
      .accounts({
        payer: provider.wallet.publicKey,
        wallet: shortPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const replacementPrimary = Buffer.alloc(33, 0x02);
    replacementPrimary[1] = 0x33;
    const replacementSecondary = Buffer.alloc(33, 0x03);
    replacementSecondary[1] = 0x44;

    await program.methods
      .initiateRecovery(Array.from(replacementPrimary), Array.from(replacementSecondary))
      .accounts({ wallet: shortPda, guardian: guardianKeypair.publicKey })
      .signers([guardianKeypair])
      .rpc();

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await program.methods.executeRecovery().accounts({ wallet: shortPda }).rpc();

    const rotated = await program.account.walletAccount.fetch(shortPda);
    assert.deepEqual(Buffer.from(rotated.primaryPasskey), replacementPrimary);
    assert.deepEqual(Buffer.from(rotated.secondaryPasskey), replacementSecondary);
    assert.equal(rotated.isFrozen, false);
    assert.equal(rotated.recoveryInitiatedAt.toNumber(), 0);
    assert.deepEqual(Buffer.from(rotated.pendingPrimaryPasskey), Buffer.alloc(33));
  });
});
