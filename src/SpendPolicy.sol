// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title SpendPolicy -- decides how many signatures a call requires.
///
/// @notice The value-only version of this logic had a hole: it read
///         `execute(dest, value, func)`'s `value` field and nothing else, so
///         `execute(USDC, 0, transfer(attacker, 1_000_000e6))` looked like a
///         zero-value call and cleared with one signature.
///
///         Closing it means the policy has to understand what the INNER
///         calldata does, not just what ETH rides along with it.
///
/// @dev Design stance: this is an ALLOWLIST, not a blocklist. Anything the
///      policy cannot positively identify as low-risk requires the full quorum.
///      A blocklist here would be unfixable -- there are unbounded ways to move
///      value, and you cannot enumerate them.
library SpendPolicy {
    // --- ERC-20 / ERC-721 selectors that move value -----------------------
    bytes4 constant TRANSFER = 0xa9059cbb;      // transfer(address,uint256)
    bytes4 constant TRANSFER_FROM = 0x23b872dd; // transferFrom(address,address,uint256)
    bytes4 constant APPROVE = 0x095ea7b3;       // approve(address,uint256)
    bytes4 constant INCREASE_ALLOWANCE = 0x39509351;
    bytes4 constant SET_APPROVAL_ALL = 0xa22cb465; // setApprovalForAll(address,bool)

    uint256 constant ONE_SIG = 1;
    uint256 constant TWO_SIGS = 2;

    /// @notice What a single call spends, decomposed so a batch can be summed.
    /// @dev `alwaysTwoSigs` is a hard escalation that no amount arithmetic can
    ///      undo -- approvals, unknown selectors, malformed encoding. It rides
    ///      alongside the amounts rather than replacing them, because a batch
    ///      containing one opaque call must escalate the WHOLE batch.
    struct Spend {
        uint256 ethAmount;
        address token;      // address(0) when this call moves no tokens
        uint256 tokenAmount;
        bool alwaysTwoSigs;
    }

    /// @notice Decompose one call into what it spends.
    /// @param dest The contract being called.
    /// @param value Native ETH riding along.
    /// @param func The inner calldata.
    function classify(address dest, uint256 value, bytes calldata func)
        internal
        pure
        returns (Spend memory s)
    {
        s.ethAmount = value;

        // A plain ETH send with no calldata: the value field says it all.
        if (func.length == 0) return s;

        // Calldata present but too short to carry a selector: opaque.
        if (func.length < 4) {
            s.alwaysTwoSigs = true;
            return s;
        }

        bytes4 sel = bytes4(func[0:4]);

        // Approvals are unbounded, persistent delegations of spending
        // authority -- strictly more dangerous than a one-off transfer.
        // No threshold arithmetic applies; they always escalate.
        if (sel == APPROVE || sel == INCREASE_ALLOWANCE || sel == SET_APPROVAL_ALL) {
            s.alwaysTwoSigs = true;
            return s;
        }

        if (sel == TRANSFER) {
            // transfer(address to, uint256 amount) -> amount at offset 36
            if (func.length < 68) { s.alwaysTwoSigs = true; return s; }
            s.token = dest;
            s.tokenAmount = uint256(bytes32(func[36:68]));
            return s;
        }

        if (sel == TRANSFER_FROM) {
            // transferFrom(address,address,uint256) -> amount at offset 68
            if (func.length < 100) { s.alwaysTwoSigs = true; return s; }
            s.token = dest;
            s.tokenAmount = uint256(bytes32(func[68:100]));
            return s;
        }

        // Arbitrary contract calls, DeFi interactions, unknown selectors --
        // not something this policy can price.
        s.alwaysTwoSigs = true;
        return s;
    }

    /// @notice Signature requirement for a SINGLE call.
    function required(
        address dest,
        uint256 value,
        bytes calldata func,
        uint256 ethThreshold,
        uint256 tokenThreshold
    ) internal pure returns (uint256) {
        Spend memory s = classify(dest, value, func);
        if (s.alwaysTwoSigs) return TWO_SIGS;
        if (s.ethAmount >= ethThreshold) return TWO_SIGS;
        if (s.token != address(0)) {
            return _checkToken(s.tokenAmount, tokenThreshold);
        }
        return ONE_SIG;
    }

    function _checkToken(uint256 amount, uint256 threshold)
        internal
        pure
        returns (uint256)
    {
        // An unconfigured token (threshold 0) is not "unlimited" -- it is
        // "unknown". Unknown tokens always require the full quorum. Treating
        // 0 as unlimited would recreate the exact bypass we are closing.
        if (threshold == 0) return TWO_SIGS;
        return amount >= threshold ? TWO_SIGS : ONE_SIG;
    }
}
