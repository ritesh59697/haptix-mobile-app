// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title SpendWindow -- rolling spend accounting under ERC-4337 constraints.
///
/// @notice Closes the sequential-UserOp hole: a stateless policy sums within
///         one UserOp, so an attacker just sends twenty of them. This tracks
///         cumulative spend across ops inside a time window.
///
/// @dev The design is shaped almost entirely by two ERC-7562 validation rules,
///      and it is worth understanding why the obvious implementation is illegal:
///
///      1. STO-010: the account MAY read and write its OWN storage during
///         validation. So the accounting itself is allowed. Good.
///
///      2. OP-011: `TIMESTAMP` (0x42) and `NUMBER` (0x43) are BANNED during
///         validation. So validation cannot ask what time it is, and therefore
///         cannot decide whether the current window has expired.
///
///      Rule 2 is the whole problem. "Reset the counter if the window rolled
///      over" is exactly the check we are forbidden from making.
///
///      The escape hatch is `validationData`'s time range. The account cannot
///      read the clock, but it can RETURN the assumption it made -- and the
///      EntryPoint checks that assumption against `block.timestamp` after
///      validation returns, reverting with "AA22 expired or not due" if it does
///      not hold.
///
///      So validation says, in effect:
///          "I authorized this ASSUMING we are still inside the window that
///           ends at T. If we are not, reject this operation."
///
///      The window is only ever ADVANCED in `execute` (post-validation), where
///      TIMESTAMP is legal. Validation only ever reads.
library SpendWindow {
    /// @dev Packed into one storage slot: a 96-bit counter + a 48-bit expiry,
    ///      so each asset costs exactly one SLOAD during validation. That keeps
    ///      validation gas predictable under a bundler's verificationGasLimit.
    ///
    ///      One window per asset: ETH is keyed by address(0), each ERC-20 by
    ///      its own token address. Per-asset windows are the only correct
    ///      shape -- 1 ETH and 1000 USDC cannot share a counter without a
    ///      price oracle, and an oracle would mean reading EXTERNAL storage
    ///      during validation, which STO-021/022 restrict and which no price
    ///      feed satisfies in practice.
    struct Window {
        uint96 spent;
        uint48 expiry; // unix seconds; 0 = no window open
    }

    /// @dev Must match PasskeyAccount.MAX_PRICED_BATCH. Declared here so the
    ///      Spend struct below is self-contained.
    uint256 internal constant MAX_ASSETS = 16;

    /// @notice Per-asset breakdown of what one UserOp spends.
    /// @param ok false when the call could not be fully priced -- callers MUST
    ///        treat that as "reject", never as "spends nothing".
    struct Spend {
        uint256 ethAmount;
        address[MAX_ASSETS] tokens;
        uint256[MAX_ASSETS] amounts;
        uint256 nTokens;
        bool ok;
    }

    /// @notice Result of checking a proposed spend against the window.
    /// @param exceeds true if this spend cannot be authorized in EITHER the
    ///        current window or a freshly-rolled one
    /// @param validUntil expiry to return in validationData (0 = unconstrained)
    /// @param validAfter earliest time this authorization is valid
    ///        (0 = immediately)
    struct Check {
        bool exceeds;
        uint48 validUntil;
        uint48 validAfter;
    }

    /// @notice Would `amount` exceed `cap` within the currently open window?
    /// @dev PURE READ. Deliberately does not consider whether the window has
    ///      expired -- it cannot, without TIMESTAMP. Instead it reports the
    ///      expiry it assumed, and the EntryPoint enforces it.
    ///
    ///      Note the conservative direction: if the window has in fact expired,
    ///      `spent` is stale and too HIGH, so we may over-reject. Over-rejecting
    ///      is safe (the user retries and the window resets in execute);
    ///      under-rejecting would be the vulnerability.
    function check(Window storage w, uint256 amount, uint256 cap)
        internal
        view
        returns (Check memory c)
    {
        uint256 spent = w.spent;
        uint48 expiry = w.expiry;

        // A single op larger than the cap can never be authorized, in any
        // window. No time range can rescue it.
        if (amount > cap) {
            c.exceeds = true;
            return c;
        }

        // No window open: this op starts one, unconstrained in time.
        if (expiry == 0) return c;

        // Does it fit in the CURRENT window, assuming that window is still open?
        bool fitsNow;
        unchecked {
            uint256 total = spent + amount;
            fitsNow = total >= spent && total <= cap;
        }

        if (fitsNow) {
            // Authorize, but bind the authorization to the window we read.
            // If the bundler holds the op past `expiry`, the EntryPoint rejects
            // with AA22 rather than applying stale accounting. The user simply
            // resubmits and gets the fresh-window branch below.
            c.validUntil = expiry;
            return c;
        }

        // It does NOT fit the current window. But validation cannot read the
        // clock (ERC-7562 OP-011), so it cannot know whether that window is
        // even still open. Rejecting outright would lock the user out forever:
        // the counter only clears in `record`, which never runs if validation
        // always fails.
        //
        // Instead, authorize against a FRESH window and constrain the op to
        // start only after the current one has ended. The EntryPoint enforces
        // `block.timestamp >= validAfter`, so this op is simply not yet
        // includable -- and becomes includable the moment the window rolls.
        //
        // amount <= cap was established above, so it necessarily fits a fresh
        // window.
        c.validAfter = expiry;
        return c;
    }

    /// @notice Record a spend and roll the window if it has expired.
    /// @dev MUST be called from execution, never validation -- it reads
    ///      TIMESTAMP, which is banned during validation.
    function record(
        Window storage w,
        uint256 amount,
        uint256 windowSeconds
    ) internal {
        uint48 nowTs = uint48(block.timestamp);

        if (w.expiry == 0 || nowTs >= w.expiry) {
            // Window closed (or never opened): start a fresh one.
            // Saturate rather than truncate -- a wrapped uint96 would record a
            // huge spend as a tiny one, which is precisely the under-counting
            // this accounting exists to prevent.
            w.spent = amount > type(uint96).max
                ? type(uint96).max
                : uint96(amount);

            uint256 exp = uint256(nowTs) + windowSeconds;
            w.expiry = exp > type(uint48).max
                ? type(uint48).max
                : uint48(exp);
        } else {
            unchecked {
                uint256 total = uint256(w.spent) + amount;
                // Saturate rather than revert. A revert here would burn the
                // user's gas after validation already passed; saturating keeps
                // the counter pinned at "definitely over the cap".
                w.spent = total > type(uint96).max
                    ? type(uint96).max
                    : uint96(total);
            }
        }
    }

    /// @notice Combine two per-asset checks into one.
    ///
    /// @dev A single UserOp can touch several assets (ETH + USDC + DAI in one
    ///      batch), and each asset has its OWN window with its OWN expiry. The
    ///      op is authorized only if EVERY asset authorizes it, and the
    ///      returned time range must be the INTERSECTION of the individual
    ///      ranges -- the op is valid only where all of them agree.
    ///
    ///      Intersection of [after_a, until_a] and [after_b, until_b] is
    ///      [max(after), min(until)], with 0 meaning "unbounded" on each side.
    ///
    ///      If the intersection is empty (validAfter > validUntil, both set)
    ///      no timestamp can satisfy it. Rather than emit a range the
    ///      EntryPoint would always reject, mark it as exceeding so the caller
    ///      returns a clean signature failure.
    function merge(Check memory a, Check memory b)
        internal
        pure
        returns (Check memory c)
    {
        if (a.exceeds || b.exceeds) {
            c.exceeds = true;
            return c;
        }

        // validAfter: the later of the two lower bounds.
        c.validAfter = a.validAfter > b.validAfter ? a.validAfter : b.validAfter;

        // validUntil: the earlier of the two upper bounds, treating 0 as
        // "unbounded" rather than "expires at the epoch".
        if (a.validUntil == 0) {
            c.validUntil = b.validUntil;
        } else if (b.validUntil == 0) {
            c.validUntil = a.validUntil;
        } else {
            c.validUntil = a.validUntil < b.validUntil ? a.validUntil : b.validUntil;
        }

        // Empty intersection: no time satisfies both constraints.
        if (c.validUntil != 0 && c.validAfter > c.validUntil) {
            c.exceeds = true;
            c.validUntil = 0;
            c.validAfter = 0;
        }
        return c;
    }

    /// @notice Pack a time range into ERC-4337 validationData.
    /// @dev Layout: authorizer (160 bits) | validUntil (48) | validAfter (48).
    ///      authorizer 0 = valid signature, 1 = SIG_VALIDATION_FAILED.
    function packValidationData(
        uint256 sigFailed,
        uint48 validUntil,
        uint48 validAfter
    ) internal pure returns (uint256) {
        return sigFailed
            | (uint256(validUntil) << 160)
            | (uint256(validAfter) << 208);
    }
}
