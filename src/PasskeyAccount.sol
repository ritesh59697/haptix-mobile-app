// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {WebAuthn} from "./WebAuthn.sol";
import {SpendPolicy} from "./SpendPolicy.sol";
import {SpendWindow} from "./SpendWindow.sol";

/// @dev Minimal subset of ERC-4337 v0.7/v0.8 PackedUserOperation.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/// @title PasskeyAccount -- an ERC-4337 account with an on-chain spending policy.
///
/// @notice The whole point of this contract: the policy is enforced HERE, inside
///         validateUserOp, not in a UI. There is no code path into this account's
///         funds that skips this function. Importing a key into MetaMask gains an
///         attacker nothing, because no EOA key controls this account.
///
///         Policy:
///           - transfers below `threshold`  -> ONE passkey signature
///           - transfers at/above threshold -> TWO distinct passkey signatures
///
/// @dev Deliberately NOT production code. See README for what is missing.
contract PasskeyAccount {
    // -----------------------------------------------------------------------
    // ERC-4337 return values
    // -----------------------------------------------------------------------
    uint256 internal constant SIG_VALIDATION_SUCCESS = 0;
    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    address public immutable entryPoint;

    struct PublicKey {
        uint256 x;
        uint256 y;
    }

    /// @notice Registered passkey signers, by id.
    mapping(uint256 => PublicKey) public signers;
    uint256 public signerCount;

    /// @notice Wei value at or above which a second signature is required.
    uint256 public threshold;

    /// @notice Per-token spend thresholds, in each token's base units.
    /// @dev Zero means "not configured", which the policy treats as UNKNOWN and
    ///      therefore full-quorum -- not as unlimited. See SpendPolicy._checkToken.
    mapping(address => uint256) public tokenThreshold;

    /// @notice Configured decimals per token, stored at configuration time.
    /// @dev Stored for client/UI reference. validateUserOp compares stored base units directly without SLOADing token.decimals().
    mapping(address => uint8) public tokenDecimals;

    // -----------------------------------------------------------------------
    // Rolling window -- closes the sequential-UserOp hole
    // -----------------------------------------------------------------------

    using SpendWindow for SpendWindow.Window;

    /// @notice Sentinel key for the native-ETH window.
    address internal constant ETH = address(0);

    /// @notice Per-asset cumulative cap a single signature may authorize within
    ///         a window. Keyed by address(0) for ETH, token address otherwise.
    /// @dev Zero means "no window configured for this asset". For ETH that
    ///      disables windowing entirely; for a token it means the token has no
    ///      rolling limit (it is still bound by the per-op tokenThreshold).
    mapping(address => uint256) public windowCap;

    /// @notice Window length in seconds. Shared across assets so a batch cannot
    ///         be split across mismatched window boundaries.
    uint256 public windowSeconds;

    /// @notice Rolling spend accounting, one window per asset.
    /// @dev A mapping in the ACCOUNT'S OWN storage. ERC-7562 STO-010 places no
    ///      restriction on which of its own slots an account may touch during
    ///      validation, mapping slots included, so this is legal to read in
    ///      validateUserOp and write in execute.
    mapping(address => SpendWindow.Window) public window;

    /// @notice Optional trusted paymaster. If address(0), any standard ERC-4337 paymaster may sponsor UserOps.
    ///         If set to a non-zero address, only that specific paymaster may sponsor ops.
    address public trustedPaymaster;

    /// @notice Emergency panic switch. When true, all transfers strictly demand 2-of-2 Quorum.
    bool public isFrozen;

    /// @notice When true, only allowlisted recipients can receive sub-threshold 1-sig transfers.
    bool public allowlistEnabled;

    /// @notice Whitelisted recipient addresses for safe 1-sig transfers.
    mapping(address => bool) public isAllowedRecipient;

    event SignerAdded(uint256 indexed id, uint256 x, uint256 y);
    event SignerRemoved(uint256 indexed id);
    event SignerReplaced(uint256 indexed id, uint256 oldX, uint256 oldY, uint256 newX, uint256 newY);
    event ThresholdChanged(uint256 newThreshold);
    event TokenThresholdChanged(address indexed token, uint256 newThreshold, uint8 decimals);
    event WindowConfigured(address indexed asset, uint256 cap, uint256 duration, uint8 decimals);
    event TrustedPaymasterChanged(address indexed paymaster);
    event AccountFrozen();
    event AccountUnfrozen();
    event AllowlistToggled(bool enabled);
    event RecipientAllowlistUpdated(address indexed recipient, bool allowed);

    error NotEntryPoint();
    error NotSelf();
    error BadSignerIndex();
    error LengthMismatch();
    error CapTooLarge();
    error DurationTooLarge();
    error NoSigners();
    error DuplicateSigner();
    error MinSignersRequired();
    error InvalidPublicKey();

    modifier onlyEntryPoint() {
        if (msg.sender != entryPoint) revert NotEntryPoint();
        _;
    }

    /// @dev Config changes must themselves travel through validateUserOp, so
    ///      raising the threshold or adding a signer is subject to the policy.
    ///      A config change that bypassed the policy would be a free bypass of
    ///      the policy itself.
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    /// @param initialSigners Passkey public keys to enrol at construction.
    ///
    /// @dev Enrolling every signer up front matters more than it looks. Config
    ///      calls (`addSigner`, `setWindow`, `setThreshold`) are `onlySelf` and
    ///      are not `execute` calls, so `_requiredSignatures` gives them the
    ///      full 2-signature quorum. An account deployed with ONE signer can
    ///      therefore never be configured -- not even to add the second signer
    ///      it would need to configure anything. It can only spend below its
    ///      per-op threshold, forever.
    ///
    ///      Deploying with one signer is still permitted (it is a valid, if
    ///      limited, configuration) but callers should know what they are
    ///      choosing.
    constructor(
        address _entryPoint,
        PublicKey[] memory initialSigners,
        uint256 _threshold
    ) {
        if (initialSigners.length < 2) revert MinSignersRequired();

        entryPoint = _entryPoint;
        for (uint256 i = 0; i < initialSigners.length; i++) {
            if (initialSigners[i].x == 0 || initialSigners[i].y == 0) revert InvalidPublicKey();
            for (uint256 j = 0; j < i; j++) {
                if (initialSigners[j].x == initialSigners[i].x && initialSigners[j].y == initialSigners[i].y) {
                    revert DuplicateSigner();
                }
            }
            signers[i] = initialSigners[i];
            emit SignerAdded(i, initialSigners[i].x, initialSigners[i].y);
        }
        signerCount = initialSigners.length;
        threshold = _threshold;
        emit ThresholdChanged(_threshold);
    }

    // -----------------------------------------------------------------------
    // ERC-4337 entry
    // -----------------------------------------------------------------------

    /// @notice Computes the standard ERC-4337 v0.7 UserOp hash, binding the operation
    ///         strictly to this account's immutable EntryPoint and the current block.chainid.
    /// @dev Prevents signature replay across chains or across untrusted EntryPoints.
    ///      Cross-chain owner / signer updates are intentionally unsupported for v1 to fail closed.
    function getUserOpHash(PackedUserOperation calldata userOp)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                keccak256(
                    abi.encode(
                        userOp.sender,
                        userOp.nonce,
                        keccak256(userOp.initCode),
                        keccak256(userOp.callData),
                        userOp.accountGasLimits,
                        userOp.preVerificationGas,
                        userOp.gasFees,
                        keccak256(userOp.paymasterAndData)
                    )
                ),
                entryPoint,
                block.chainid
            )
        );
    }

    /// @notice Called by the EntryPoint before executing the UserOp.
    ///
    /// @return validationData packed as: authorizer (160) | validUntil (48) |
    ///         validAfter (48). authorizer is 0 on success, 1 on signature
    ///         failure.
    ///
    ///         When a rolling window is open, `validUntil` is set to that
    ///         window's expiry. This is the mechanism that closes the
    ///         sequential-UserOp hole: validation cannot read TIMESTAMP
    ///         (banned by ERC-7562 OP-011), so it cannot tell whether the
    ///         window is still open. Instead it returns the window it ASSUMED,
    ///         and the EntryPoint checks that assumption against
    ///         block.timestamp -- reverting "AA22 expired or not due" if the
    ///         window had already closed. See SpendWindow for the full
    ///         reasoning.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        bool ok = _validateSignature(userOp, userOpHash);

        // Pay the EntryPoint for gas regardless of validity; the EntryPoint
        // handles refunds. Must happen even on failure per the 4337 spec.
        if (missingAccountFunds > 0) {
            (bool sent, ) = payable(msg.sender).call{value: missingAccountFunds}("");
            sent; // EntryPoint reverts on shortfall; nothing useful to do here.
        }

        if (!ok) return SIG_VALIDATION_FAILED;

        // Signature is good. Now: does this op fit inside the rolling window?
        // Only single-signature ops are window-constrained -- a full quorum is
        // the user deliberately overriding their own limit, which is the entire
        // point of having a second factor.
        (uint256[] memory ids, ) =
            abi.decode(userOp.signature, (uint256[], WebAuthn.Signature[]));

        if (ids.length >= 2) return SIG_VALIDATION_SUCCESS;

        SpendWindow.Check memory c = _checkWindows(userOp.callData);
        if (c.exceeds) return SIG_VALIDATION_FAILED;

        return SpendWindow.packValidationData(
            SIG_VALIDATION_SUCCESS, c.validUntil, c.validAfter
        );
    }

    /// @dev Check this call against EVERY asset window it touches, and
    ///      intersect the resulting time ranges. The op is authorized only
    ///      where all assets agree it is authorized.
    function _checkWindows(bytes calldata callData)
        internal
        view
        returns (SpendWindow.Check memory c)
    {
        SpendWindow.Spend memory sp = _spendOf(callData);
        if (!sp.ok) {
            c.exceeds = true;
            return c;
        }

        // ETH leg.
        uint256 ethCap = windowCap[ETH];
        if (ethCap != 0) {
            c = window[ETH].check(sp.ethAmount, ethCap);
            if (c.exceeds) return c;
        } else if (sp.ethAmount > 0 && _anyWindowConfigured()) {
            // ETH window not configured: unconstrained, matching the
            // "zero means disabled" rule. Nothing to merge.
        }

        // Each distinct token costs an SLOAD plus a check. Measured at ~28k
        // gas per token in a batch of distinct tokens (test/BatchGas.t.sol),
        // so an unbounded count would blow past a bundler's
        // verificationGasLimit and make the op unusable rather than merely
        // expensive. Beyond the limit, escalate to a full quorum instead.
        if (sp.nTokens > MAX_PRICED_ASSETS) {
            c.exceeds = true;
            return c;
        }

        // Token legs.
        for (uint256 i = 0; i < sp.nTokens; i++) {
            uint256 cap = windowCap[sp.tokens[i]];
            if (cap == 0) continue; // no rolling limit for this token

            SpendWindow.Check memory tc =
                window[sp.tokens[i]].check(sp.amounts[i], cap);
            c = SpendWindow.merge(c, tc);
            if (c.exceeds) return c;
        }
        return c;
    }

    /// @dev Cheap probe so the ETH branch above reads clearly; windowSeconds is
    ///      only nonzero once setWindow has been called at least once.
    function _anyWindowConfigured() private view returns (bool) {
        return windowSeconds != 0;
    }

    /// @dev Per-asset breakdown of what a callData spends.
    function _spendOf(bytes calldata callData)
        internal
        view
        returns (SpendWindow.Spend memory sp)
    {
        if (callData.length < 4) return sp; // ok = false
        bytes4 sel = bytes4(callData[0:4]);

        if (sel == this.execute.selector) {
            if (callData.length < 68) return sp;
            address dest = address(uint160(uint256(bytes32(callData[4:36]))));
            uint256 value = uint256(bytes32(callData[36:68]));
            (bytes calldata func, bool decoded) = _extractFunc(callData);
            if (!decoded) return sp;

            // Emergency freeze is a 0-value self-call that moves no assets
            if (dest == address(this) && func.length >= 4 && bytes4(func[0:4]) == this.freeze.selector) {
                sp.ok = true;
                return sp;
            }

            SpendPolicy.Spend memory s = SpendPolicy.classify(dest, value, func);
            if (s.alwaysTwoSigs) return sp; // unpriceable -> reject

            sp.ethAmount = s.ethAmount;
            if (s.token != address(0)) {
                sp.tokens[0] = s.token;
                sp.amounts[0] = s.tokenAmount;
                sp.nTokens = 1;
            }
            sp.ok = true;
            return sp;
        }

        if (sel == this.executeBatch.selector) {
            BatchTotals memory t = _sumBatch(callData);
            if (!t.ok) return sp;
            sp.ethAmount = t.ethTotal;
            sp.tokens = t.tokens;
            sp.amounts = t.amounts;
            sp.nTokens = t.nTokens;
            sp.ok = true;
            return sp;
        }

        // Config calls require a full quorum via _requiredSignatures, so they
        // never reach here with a single signature.
        return sp;
    }

    /// @dev Signature payload: abi.encode(uint256[] signerIds, WebAuthn.Signature[] sigs)
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view returns (bool) {
        if (userOp.signature.length < 64) return false;

        // Fast calldata check of signer IDs before allocating memory or decoding structs.
        // Rejects duplicate, unordered, or out-of-range IDs in < 2k gas.
        uint256 idsOffset = uint256(bytes32(userOp.signature[0:32]));
        if (idsOffset + 32 <= userOp.signature.length) {
            uint256 len = uint256(bytes32(userOp.signature[idsOffset:idsOffset + 32]));
            if (idsOffset + 32 + len * 32 <= userOp.signature.length) {
                uint256 lastId = 0;
                for (uint256 i = 0; i < len; i++) {
                    uint256 id = uint256(bytes32(userOp.signature[idsOffset + 32 + i * 32:idsOffset + 64 + i * 32]));
                    if (i > 0 && id <= lastId) return false;
                    if (id >= signerCount) return false;
                    lastId = id;
                }
            }
        }

        (uint256[] memory ids, WebAuthn.Signature[] memory sigs) =
            abi.decode(userOp.signature, (uint256[], WebAuthn.Signature[]));

        if (ids.length != sigs.length || ids.length == 0) return false;

        uint256 required = _requiredSignatures(userOp.callData);
        if (ids.length < required) return false;

        // Validate paymaster if present:
        if (userOp.paymasterAndData.length > 0) {
            if (userOp.paymasterAndData.length < 20) return false;
            if (trustedPaymaster != address(0)) {
                address pm = address(bytes20(userOp.paymasterAndData[0:20]));
                if (pm != trustedPaymaster) return false;
            }
        }

        for (uint256 i = 0; i < ids.length; i++) {
            if (i > 0 && ids[i] <= ids[i - 1]) return false;
            if (ids[i] >= signerCount) return false;
        }

        for (uint256 i = 0; i < ids.length; i++) {
            PublicKey memory pk = signers[ids[i]];
            bool ok = WebAuthn.verify(
                abi.encodePacked(userOpHash),
                true, // require user verification (biometric), not mere presence
                sigs[i],
                pk.x,
                pk.y
            );
            if (!ok) return false;
        }
        return true;
    }

    /// @dev Decide how many signatures this call needs.
    ///
    ///      This looks INSIDE the call, not just at the ETH riding along with
    ///      it. A value-only check is bypassed trivially by any ERC-20 transfer,
    ///      which moves arbitrary value while `value == 0`.
    ///
    ///      Anything not positively recognized as low-risk gets the full quorum.
    function _requiredSignatures(bytes calldata callData)
        internal
        view
        returns (uint256)
    {
        if (callData.length < 4) return 2;
        bytes4 sel = bytes4(callData[0:4]);

        // Emergency freeze trigger: allow 1 signature to freeze the account instantly
        if (sel == this.execute.selector && callData.length >= 68) {
            address target = address(uint160(uint256(bytes32(callData[4:36]))));
            (bytes calldata innerFunc, bool decodedInner) = _extractFunc(callData);
            if (target == address(this) && decodedInner && innerFunc.length >= 4 && bytes4(innerFunc[0:4]) == this.freeze.selector) {
                return 1;
            }
        }

        // If frozen, all other operations strictly require full 2-of-2 quorum
        if (isFrozen) return 2;

        // Length guard: a truncated execute() call must fall through to the
        // 2-signature default, not revert on an out-of-bounds slice. Reverting
        // inside validateUserOp is worse than rejecting -- it fails the whole
        // op at the EntryPoint rather than returning a clean validation error.
        if (sel == this.executeBatch.selector) {
            return _requiredSignaturesBatch(callData);
        }

        if (sel != this.execute.selector || callData.length < 68) return 2;

        // execute(address dest, uint256 value, bytes func)
        address dest = address(uint160(uint256(bytes32(callData[4:36]))));
        uint256 value = uint256(bytes32(callData[36:68]));

        // Decode the dynamic `func` argument. Its offset lives at callData[68:100]
        // and is relative to the start of the argument block (callData + 4).
        (bytes calldata func, bool decoded) = _extractFunc(callData);

        // A decode failure is NOT the same as "no calldata". Malformed ABI
        // encoding means we cannot see what this call does, so it gets the
        // full quorum. Conflating the two let garbage calldata masquerade as a
        // harmless zero-value ETH send and clear with a single signature.
        if (!decoded) return 2;

        // Recipient Allowlist Check: transfers to non-allowlisted addresses escalate to Quorum
        if (allowlistEnabled) {
            address recipient = SpendPolicy.extractRecipient(dest, func);
            if (recipient == address(0) || !isAllowedRecipient[recipient]) {
                return 2;
            }
        }

        return SpendPolicy.required(
            dest, value, func, threshold, tokenThreshold[dest]
        );
    }

    /// @dev Maximum batch entries the policy will attempt to price. A batch
    ///      longer than this is not rejected outright -- it just cannot be
    ///      summed within a sane gas budget, so it escalates to full quorum.
    ///      ERC-4337 validation runs under a bundler-enforced
    ///      verificationGasLimit; an unbounded loop here would be a
    ///      denial-of-service on the account's own validation.
    ///
    ///      Measured cost (test/BatchGas.t.sol): ~107k baseline, dominated by
    ///      the single P-256 verification, plus ~6.5k per entry. 16 entries
    ///      lands at ~194k, inside typical bundler limits. Growth is linear,
    ///      not quadratic, despite the nested token-dedup scan -- because that
    ///      inner loop is bounded by the same constant.
    uint256 internal constant MAX_PRICED_BATCH = 16;

    /// @dev Maximum DISTINCT assets whose rolling windows the policy will check
    ///      in one op. Separate from MAX_PRICED_BATCH because the cost profile
    ///      differs: batch entries are ~6.5k gas each, but each distinct token
    ///      adds an SLOAD and a merge, measured at ~28k. Sixteen distinct
    ///      tokens reached ~445k gas, past common bundler verificationGasLimit
    ///      defaults -- so cap the priced set and escalate beyond it.
    uint256 internal constant MAX_PRICED_ASSETS = 4;

    /// @dev Per-asset running totals for a batch.
    struct BatchTotals {
        uint256 ethTotal;
        address[MAX_PRICED_BATCH] tokens;
        uint256[MAX_PRICED_BATCH] amounts;
        uint256 nTokens;
        bool ok;
    }

    /// @dev Sum a batch per-asset, then apply the thresholds ONCE to the totals.
    ///
    ///      This is the whole point of batch support. Pricing each entry
    ///      independently would let an attacker split a 10 ETH transfer into
    ///      eleven 0.9 ETH transfers -- each individually "small" -- and drain
    ///      the account with one signature.
    ///
    ///      Assets are summed SEPARATELY. ETH and USDC are different units and
    ///      adding them would be meaningless; a single running total would also
    ///      let a large ETH amount mask a large token amount or vice versa.
    function _requiredSignaturesBatch(bytes calldata callData)
        internal
        view
        returns (uint256)
    {
        BatchTotals memory t = _sumBatch(callData);

        // Any decode failure, over-length batch, opaque call, or arithmetic
        // overflow escalates the entire batch.
        if (!t.ok) return 2;

        if (t.ethTotal >= threshold) return 2;

        for (uint256 i = 0; i < t.nTokens; i++) {
            if (
                SpendPolicy._checkToken(t.amounts[i], tokenThreshold[t.tokens[i]])
                    == 2
            ) {
                return 2;
            }
        }
        return 1;
    }

    /// @dev Walk the batch calldata, classify each entry, and accumulate totals
    ///      per asset. Leaves `ok` false on anything it cannot fully price.
    function _sumBatch(bytes calldata callData)
        private
        view
        returns (BatchTotals memory t)
    {
        // executeBatch(address[] dests, uint256[] values, bytes[] funcs)
        // Three dynamic arrays; head is 3 offsets at 4, 36, 68.
        if (callData.length < 100) return t;

        (uint256 dOff, bool d1) = _arrayStart(callData, 4);
        (uint256 vOff, bool d2) = _arrayStart(callData, 36);
        (uint256 fOff, bool d3) = _arrayStart(callData, 68);
        if (!d1 || !d2 || !d3) return t;

        uint256 n = uint256(bytes32(callData[dOff:dOff + 32]));
        {
            uint256 nv = uint256(bytes32(callData[vOff:vOff + 32]));
            uint256 nf = uint256(bytes32(callData[fOff:fOff + 32]));
            // Mismatched lengths revert in executeBatch anyway; refuse to price.
            if (n != nv || n != nf) return t;
        }
        if (n > MAX_PRICED_BATCH) return t;

        // Element regions start right after each length word.
        uint256 dBase = dOff + 32;
        uint256 vBase = vOff + 32;
        uint256 fBase = fOff + 32;
        if (dBase + n * 32 > callData.length) return t;
        if (vBase + n * 32 > callData.length) return t;
        if (fBase + n * 32 > callData.length) return t;

        for (uint256 i = 0; i < n; i++) {
            if (!_accumulate(callData, t, dBase, vBase, fBase, i)) return t;
        }

        t.ok = true;
        return t;
    }

    /// @dev Classify batch entry `i` and fold it into the running totals.
    ///      Split out from _sumBatch purely to stay under the stack limit.
    function _accumulate(
        bytes calldata callData,
        BatchTotals memory t,
        uint256 dBase,
        uint256 vBase,
        uint256 fBase,
        uint256 i
    ) private view returns (bool) {
        address dest = address(uint160(uint256(
            bytes32(callData[dBase + i * 32:dBase + i * 32 + 32])
        )));
        uint256 value = uint256(
            bytes32(callData[vBase + i * 32:vBase + i * 32 + 32])
        );

        (bytes calldata func, bool fok) = _batchElement(callData, fBase, i);
        if (!fok) return false;

        SpendPolicy.Spend memory s = SpendPolicy.classify(dest, value, func);
        if (s.alwaysTwoSigs) return false;

        // Allowlist check in batch: any unapproved recipient escalates the whole batch
        if (allowlistEnabled) {
            address recipient = SpendPolicy.extractRecipient(dest, func);
            if (recipient == address(0) || !isAllowedRecipient[recipient]) {
                return false;
            }
        }

        // Overflow would wrap a huge total into a small one -- the exact shape
        // of bypass this function exists to prevent. Solidity 0.8 reverts on
        // overflow, and a revert inside validateUserOp is worse than a clean
        // rejection, so check explicitly under `unchecked`.
        unchecked {
            uint256 newEth = t.ethTotal + s.ethAmount;
            if (newEth < t.ethTotal) return false;
            t.ethTotal = newEth;
        }

        if (s.token != address(0)) {
            uint256 j = 0;
            for (; j < t.nTokens; j++) {
                if (t.tokens[j] == s.token) break;
            }
            if (j == t.nTokens) {
                // Stop as soon as the op touches more distinct assets than we
                // will price. Bailing out HERE rather than after the loop is
                // what actually saves the gas -- otherwise the expensive
                // dedup scan has already run by the time anyone checks.
                if (t.nTokens == MAX_PRICED_ASSETS) return false;
                t.tokens[j] = s.token;
                t.nTokens++;
            }
            unchecked {
                uint256 newAmt = t.amounts[j] + s.tokenAmount;
                if (newAmt < t.amounts[j]) return false;
                t.amounts[j] = newAmt;
            }
        }
        return true;
    }

    /// @dev Read a dynamic array's offset word at `headPos` and return the
    ///      absolute position of its length word.
    function _arrayStart(bytes calldata callData, uint256 headPos)
        private
        pure
        returns (uint256 pos, bool ok)
    {
        if (headPos + 32 > callData.length) return (0, false);
        uint256 off = uint256(bytes32(callData[headPos:headPos + 32]));
        // executeBatch has a 3-word (96 byte) static head; offsets < 96 are malformed
        if (off < 96 || off > type(uint32).max) return (0, false);
        pos = 4 + off; // offsets are relative to the argument block
        if (pos + 32 > callData.length) return (0, false);
        return (pos, true);
    }

    /// @dev Extract element `i` of a bytes[] whose element-offset region starts
    ///      at `fBase`.
    function _batchElement(bytes calldata callData, uint256 fBase, uint256 i)
        private
        pure
        returns (bytes calldata func, bool ok)
    {
        uint256 headPos = fBase + i * 32;
        if (headPos + 32 > callData.length) return (callData[0:0], false);

        uint256 off = uint256(bytes32(callData[headPos:headPos + 32]));
        if (off > type(uint32).max) return (callData[0:0], false);

        uint256 lenPos = fBase + off; // relative to the start of the bytes[] data
        if (lenPos + 32 > callData.length) return (callData[0:0], false);

        uint256 len = uint256(bytes32(callData[lenPos:lenPos + 32]));
        if (len > type(uint32).max) return (callData[0:0], false);

        uint256 start = lenPos + 32;
        if (start + len > callData.length) return (callData[0:0], false);

        return (callData[start:start + len], true);
    }

    /// @dev Safely slice out the `func` argument of execute().
    /// @return func the inner calldata (empty slice when decoding failed)
    /// @return decoded false if the ABI encoding is malformed -- callers MUST
    ///         treat this as "unknown call", never as "empty call".
    function _extractFunc(bytes calldata callData)
        private
        pure
        returns (bytes calldata func, bool decoded)
    {
        if (callData.length < 100) return (callData[0:0], false);

        uint256 off = uint256(bytes32(callData[68:100]));
        // execute() has a 3-word (96 byte) static head; offsets < 96 are malformed.
        // Guard against overflow and out-of-range offsets.
        if (off < 96 || off > type(uint64).max) return (callData[0:0], false);
        uint256 lenPos = 4 + off;
        if (lenPos + 32 > callData.length) return (callData[0:0], false);

        uint256 len = uint256(bytes32(callData[lenPos:lenPos + 32]));
        if (len > type(uint64).max) return (callData[0:0], false);
        uint256 start = lenPos + 32;
        if (start + len > callData.length) return (callData[0:0], false);

        return (callData[start:start + len], true);
    }

    // -----------------------------------------------------------------------
    // Execution
    // -----------------------------------------------------------------------

    function execute(address dest, uint256 value, bytes calldata func)
        external
        onlyEntryPoint
    {
        _recordCall(dest, value, func);
        _call(dest, value, func);
    }

    /// @notice Execute several calls atomically.
    /// @dev The policy sums this batch per-asset before authorizing it. See
    ///      _requiredSignaturesBatch -- without that, batching would be a free
    ///      bypass: split one large transfer into N small ones, each under the
    ///      threshold, and clear the whole thing with a single signature.
    function executeBatch(
        address[] calldata dests,
        uint256[] calldata values,
        bytes[] calldata funcs
    ) external onlyEntryPoint {
        if (dests.length != values.length || dests.length != funcs.length) {
            revert LengthMismatch();
        }

        for (uint256 i = 0; i < dests.length; i++) {
            _recordCall(dests[i], values[i], funcs[i]);
        }

        for (uint256 i = 0; i < dests.length; i++) {
            _call(dests[i], values[i], funcs[i]);
        }
    }

    /// @dev Advance the rolling windows for one call. Called ONLY from
    ///      execution paths -- it reads block.timestamp, which ERC-7562 bans
    ///      during validation. This asymmetry (validation reads, execution
    ///      writes) is the core of the design, not an accident of structure.
    function _recordCall(address dest, uint256 value, bytes calldata func)
        private
    {
        if (windowSeconds == 0) return; // windowing disabled entirely

        SpendPolicy.Spend memory s = SpendPolicy.classify(dest, value, func);

        if (value > 0 && windowCap[ETH] != 0) {
            window[ETH].record(value, windowSeconds);
        }
        if (s.token != address(0) && s.tokenAmount > 0
            && windowCap[s.token] != 0) {
            window[s.token].record(s.tokenAmount, windowSeconds);
        }
    }

    function _call(address dest, uint256 value, bytes calldata func) private {
        (bool ok, bytes memory ret) = dest.call{value: value}(func);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    // -----------------------------------------------------------------------
    // Config -- reachable only via a UserOp through validateUserOp
    // -----------------------------------------------------------------------

    /// @notice Returns true if the P-256 public key (x, y) is already an enrolled signer.
    function isSigner(uint256 x, uint256 y) public view returns (bool) {
        return _isSigner(x, y);
    }

    function _isSigner(uint256 x, uint256 y) internal view returns (bool) {
        for (uint256 i = 0; i < signerCount; i++) {
            if (signers[i].x == x && signers[i].y == y) return true;
        }
        return false;
    }

    /// @notice Enrolls a new P-256 passkey.
    /// @dev onlySelf, so it requires a 2-of-2 hardware quorum.
    function addSigner(uint256 x, uint256 y) external onlySelf {
        if (x == 0 || y == 0) revert InvalidPublicKey();
        if (_isSigner(x, y)) revert DuplicateSigner();
        uint256 id = signerCount++;
        signers[id] = PublicKey(x, y);
        emit SignerAdded(id, x, y);
    }

    /// @notice Removes an existing passkey by id. Cannot drop remaining signers below 2.
    /// @dev Uses swap-and-pop to maintain dense contiguous signer indices [0..signerCount-1].
    function removeSigner(uint256 id) external onlySelf {
        if (id >= signerCount) revert BadSignerIndex();
        if (signerCount <= 2) revert MinSignersRequired();

        uint256 lastIdx = signerCount - 1;
        if (id != lastIdx) {
            signers[id] = signers[lastIdx];
        }
        delete signers[lastIdx];
        signerCount--;
        emit SignerRemoved(id);
    }

    /// @notice Replaces an existing passkey with a new one atomically.
    function replaceSigner(uint256 id, uint256 newX, uint256 newY) external onlySelf {
        if (id >= signerCount) revert BadSignerIndex();
        if (newX == 0 || newY == 0) revert InvalidPublicKey();
        if (_isSigner(newX, newY)) revert DuplicateSigner();

        PublicKey memory old = signers[id];
        signers[id] = PublicKey(newX, newY);
        emit SignerReplaced(id, old.x, old.y, newX, newY);
    }

    function setThreshold(uint256 newThreshold) external onlySelf {
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    /// @notice Configure a per-token spend threshold in base units, recording token decimals for client reference.
    /// @dev Reachable only via a UserOp, so raising a threshold is itself
    ///      subject to the policy -- and since setTokenThreshold is not an
    ///      `execute` call, it always requires the full quorum.
    function setTokenThreshold(address token, uint256 newThreshold, uint8 decimals)
        external
        onlySelf
    {
        tokenThreshold[token] = newThreshold;
        tokenDecimals[token] = decimals;
        emit TokenThresholdChanged(token, newThreshold, decimals);
    }

    /// @notice Configure the rolling spend window for one asset in base units, recording decimals.
    /// @param asset address(0) for native ETH, otherwise the token address.
    /// @param cap Cumulative amount a single signature may authorize per
    ///        window, in that asset's base units. Zero removes the rolling
    ///        limit for this asset.
    /// @param duration Window length in seconds, shared across all assets.
    /// @param decimals Asset decimals (e.g. 6 for USDC, 18 for ETH / DAI).
    /// @dev onlySelf, so changing a cap needs a UserOp -- and since this is not
    ///      an `execute` call, _requiredSignatures gives it the full quorum.
    ///      An attacker holding one passkey cannot raise their own limit.
    function setWindow(address asset, uint256 cap, uint256 duration, uint8 decimals)
        external
        onlySelf
    {
        if (cap > type(uint96).max) revert CapTooLarge();
        if (duration > type(uint48).max) revert DurationTooLarge();
        windowCap[asset] = cap;
        windowSeconds = duration;
        tokenDecimals[asset] = decimals;
        emit WindowConfigured(asset, cap, duration, decimals);
    }

    /// @notice Configure a trusted paymaster address.
    /// @param newPaymaster The address of the trusted paymaster, or address(0) to allow any standard paymaster.
    /// @dev onlySelf, so changing this configuration requires a 2-of-N quorum via a UserOp.
    function setTrustedPaymaster(address newPaymaster) external onlySelf {
        trustedPaymaster = newPaymaster;
        emit TrustedPaymasterChanged(newPaymaster);
    }

    /// @notice Emergency freeze switch. Can be triggered directly or via a 1-sig UserOp.
    ///         When frozen, ALL transfers strictly demand 2-of-2 Hardware Quorum.
    function freeze() external {
        if (msg.sender != address(this) && msg.sender != entryPoint) revert NotSelf();
        isFrozen = true;
        emit AccountFrozen();
    }

    /// @notice Unfreezes the account. Strictly requires 2-of-2 Hardware Quorum via onlySelf.
    function unfreeze() external onlySelf {
        isFrozen = false;
        emit AccountUnfrozen();
    }

    /// @notice Enables or disables the recipient allowlist address book.
    function setAllowlistEnabled(bool enabled) external onlySelf {
        allowlistEnabled = enabled;
        emit AllowlistToggled(enabled);
    }

    /// @notice Adds or removes an address from the trusted recipient allowlist.
    function setAllowedRecipient(address recipient, bool allowed) external onlySelf {
        isAllowedRecipient[recipient] = allowed;
        emit RecipientAllowlistUpdated(recipient, allowed);
    }

    /// @notice Batch updates trusted recipient allowlist.
    function setAllowedRecipients(address[] calldata recipients, bool[] calldata alloweds) external onlySelf {
        if (recipients.length != alloweds.length) revert LengthMismatch();
        for (uint256 i = 0; i < recipients.length; i++) {
            isAllowedRecipient[recipients[i]] = alloweds[i];
            emit RecipientAllowlistUpdated(recipients[i], alloweds[i]);
        }
    }

    // -----------------------------------------------------------------------
    // ERC-1271 & EIP-712 Off-Chain Message Verification
    // -----------------------------------------------------------------------

    bytes4 internal constant ERC1271_MAGICVALUE = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;

    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant MSG_TYPEHASH =
        keccak256("PasskeyAccountMessage(bytes32 messageHash)");

    /// @notice Returns the EIP-712 domain separator for this account.
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("PasskeyAccount")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Computes the EIP-712 digest for ERC-1271 message signing.
    function getMessageHash(bytes32 messageHash) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(MSG_TYPEHASH, messageHash))
            )
        );
    }

    /// @notice ERC-1271 off-chain signature verification for dApp sign-in / login.
    /// @dev 1-of-N enrolled passkeys is sufficient to sign in off-chain.
    ///      Binds to EIP-712 domain (name, version, chainId, verifyingContract).
    ///      Replay-safe: digest construction prevents reuse as a UserOp hash.
    /// @param hash The raw message hash requested by the dApp.
    /// @param signature abi.encode(uint256 signerId, WebAuthn.Signature sig)
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        if (signature.length < 64) return ERC1271_INVALID;

        (uint256 signerId, WebAuthn.Signature memory sig) =
            abi.decode(signature, (uint256, WebAuthn.Signature));
        if (signerId >= signerCount) return ERC1271_INVALID;

        bytes32 digest = getMessageHash(hash);
        PublicKey memory pk = signers[signerId];

        bool ok = WebAuthn.verify(
            abi.encodePacked(digest),
            true, // require user verification (biometric)
            sig,
            pk.x,
            pk.y
        );

        return ok ? ERC1271_MAGICVALUE : ERC1271_INVALID;
    }

    receive() external payable {}
}
