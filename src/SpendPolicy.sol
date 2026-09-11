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
    // --- ERC-20 / ERC-721 / Permit selectors -----------------------------
    bytes4 constant TRANSFER = 0xa9059cbb;           // transfer(address,uint256)
    bytes4 constant TRANSFER_FROM = 0x23b872dd;      // transferFrom(address,address,uint256)
    bytes4 constant APPROVE = 0x095ea7b3;            // approve(address,uint256)
    bytes4 constant INCREASE_ALLOWANCE = 0x39509351; // increaseAllowance(address,uint256)
    bytes4 constant DECREASE_ALLOWANCE = 0xa457c2d7; // decreaseAllowance(address,uint256)
    bytes4 constant SET_APPROVAL_ALL = 0xa22cb465;   // setApprovalForAll(address,bool)
    bytes4 constant PERMIT = 0xd505accf;             // permit(address,address,uint256,uint256,uint8,bytes32,bytes32) - EIP-2612
    bytes4 constant PERMIT_DAI = 0x8fcbaf0c;         // permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32) - DAI style
    bytes4 constant PERMIT2_PERMIT = 0x2b67b570;     // Uniswap Permit2 single permit
    bytes4 constant PERMIT2_PERMIT_BATCH = 0x2a2b8275; // Uniswap Permit2 batch permit
    bytes4 constant PERMIT2_TRANSFER_FROM = 0x30f28b7a; // Uniswap Permit2 permitTransferFrom

    // --- DeFi / Uniswap V3 selectors ------------------------------------
    bytes4 constant UNISWAP_V3_EXACT_INPUT_SINGLE = 0x04e45aaf; // SwapRouter02 exactInputSingle
    bytes4 constant UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1 = 0x414bf389; // SwapRouter exactInputSingle

    uint256 constant ONE_SIG = 1;
    uint256 constant TWO_SIGS = 2;

    /// @notice What a single call spends, decomposed so a batch can be summed.
    /// @dev `alwaysTwoSigs` is a hard escalation that no amount arithmetic can
    ///      undo -- approvals, permits, unknown selectors, malformed encoding. It rides
    ///      alongside the amounts rather than replacing them, because a batch
    ///      containing one opaque call must escalate the WHOLE batch.
    struct Spend {
        uint256 ethAmount;
        address token;      // address(0) when this call moves no tokens
        uint256 tokenAmount;
        bool alwaysTwoSigs;
    }

    /// @notice Parsed parameters from a Uniswap V3 exactInputSingle call.
    struct SwapParams {
        address tokenIn;
        address tokenOut;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        bool isValid;
    }

    /// @notice Returns true if the selector represents an unbounded allowance or permit operation.
    function isRestrictedApprovalOrPermit(bytes4 sel) internal pure returns (bool) {
        return (
            sel == APPROVE ||
            sel == INCREASE_ALLOWANCE ||
            sel == DECREASE_ALLOWANCE ||
            sel == SET_APPROVAL_ALL ||
            sel == PERMIT ||
            sel == PERMIT_DAI ||
            sel == PERMIT2_PERMIT ||
            sel == PERMIT2_PERMIT_BATCH ||
            sel == PERMIT2_TRANSFER_FROM
        );
    }

    /// @notice Safely decodes parameters of a Uniswap V3 exactInputSingle call.
    function decodeUniswapV3ExactInputSingle(bytes calldata func)
        internal
        pure
        returns (SwapParams memory p)
    {
        if (func.length < 4) return p;
        bytes4 sel = bytes4(func[0:4]);
        if (sel == UNISWAP_V3_EXACT_INPUT_SINGLE || sel == UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1) {
            bool isV2Router = (sel == UNISWAP_V3_EXACT_INPUT_SINGLE);
            if (func.length < (isV2Router ? 228 : 260)) return p;
            p.tokenIn = address(uint160(uint256(bytes32(func[4:36]))));
            p.tokenOut = address(uint160(uint256(bytes32(func[36:68]))));
            p.recipient = address(uint160(uint256(bytes32(func[100:132]))));
            uint256 inOff = isV2Router ? 132 : 164;
            p.amountIn = uint256(bytes32(func[inOff:inOff + 32]));
            p.amountOutMinimum = uint256(bytes32(func[inOff + 32:inOff + 64]));
            if (p.tokenIn == address(0) || p.tokenOut == address(0) || p.tokenIn == p.tokenOut) return p;
            p.isValid = true;
            return p;
        }
        return p;
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

        // Calldata present but too short to carry a selector: opaque -> always full quorum.
        if (func.length < 4) {
            s.alwaysTwoSigs = true;
            return s;
        }

        bytes4 sel = bytes4(func[0:4]);

        // Approvals, allowance changes, and permits are unbounded, persistent delegations of
        // spending authority -- strictly more dangerous than a one-off transfer.
        // No threshold arithmetic applies; they always escalate.
        if (isRestrictedApprovalOrPermit(sel)) {
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

        if (sel == UNISWAP_V3_EXACT_INPUT_SINGLE || sel == UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1) {
            SwapParams memory sp = decodeUniswapV3ExactInputSingle(func);
            if (!sp.isValid) {
                s.alwaysTwoSigs = true;
                return s;
            }
            s.token = sp.tokenIn;
            s.tokenAmount = sp.amountIn;
            return s;
        }

        // Arbitrary contract calls, DeFi interactions, unknown selectors --
        // not something this policy can price.
        s.alwaysTwoSigs = true;
        return s;
    }


    /// @notice Extracts the end recipient of a transfer or swap.
    /// @return recipient The destination address receiving the asset, or address(0) if opaque/unknown.
    function extractRecipient(address dest, bytes calldata func)
        internal
        pure
        returns (address recipient)
    {
        if (func.length == 0) return dest;
        if (func.length < 4) return address(0);
        bytes4 sel = bytes4(func[0:4]);
        if (sel == TRANSFER) {
            if (func.length < 68) return address(0);
            return address(uint160(uint256(bytes32(func[4:36]))));
        }
        if (sel == TRANSFER_FROM) {
            if (func.length < 100) return address(0);
            return address(uint160(uint256(bytes32(func[36:68]))));
        }
        if (sel == UNISWAP_V3_EXACT_INPUT_SINGLE || sel == UNISWAP_V3_EXACT_INPUT_SINGLE_ROUTER1) {
            SwapParams memory sp = decodeUniswapV3ExactInputSingle(func);
            if (sp.isValid) return sp.recipient;
        }
        return address(0);
    }
}

