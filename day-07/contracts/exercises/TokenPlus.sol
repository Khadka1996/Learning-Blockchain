// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MiniToken} from "../MiniToken.sol";

/// @title TokenPlus
/// @notice Worked solutions to the Day 07 exercises, built on MiniToken:
/// 1. increaseAllowance / decreaseAllowance   2. burnFrom (burn using an allowance)
/// 4. an owner-only, capped `mint`            5. approveIfCurrent: a compare-and-set `approve`
///    that closes the classic "approve race"
/// @dev Educational, NOT audited.
contract TokenPlus is MiniToken {
    address public immutable owner;
    uint256 public immutable cap;

    error NotOwner(address caller);
    error ExceededCap(uint256 increasedSupply, uint256 cap);
    error AllowanceBelowZero(address spender, uint256 current, uint256 subtracted);
    error AllowanceChanged(uint256 current, uint256 expected);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply, uint256 cap_)
        MiniToken(name_, symbol_, initialSupply)
    {
        if (initialSupply > cap_) revert ExceededCap(initialSupply, cap_);
        owner = msg.sender;
        cap = cap_;
    }

    /// @notice Exercise 1.
    function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
        _approve(msg.sender, spender, allowance[msg.sender][spender] + addedValue, true);
        return true;
    }

    /// @notice Exercise 1. Refuses to go below zero instead of silently clamping.
    function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
        uint256 current = allowance[msg.sender][spender];
        if (current < subtractedValue) revert AllowanceBelowZero(spender, current, subtractedValue);
        unchecked {
            _approve(msg.sender, spender, current - subtractedValue, true);
        }
        return true;
    }

    /// @notice Exercise 2: burn tokens of `from`, paid for by the caller's allowance.
    function burnFrom(address from, uint256 value) external {
        _spendAllowance(from, msg.sender, value);
        _update(from, address(0), value);
    }

    /// @notice Exercise 4: owner-only mint that can never push the supply past `cap`.
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        uint256 increased = totalSupply + amount;
        if (increased > cap) revert ExceededCap(increased, cap);
        _update(address(0), to, amount);
    }

    /// @notice Exercise 5: change an allowance only if it is STILL what you think it is.
    /// If the spender used some of it in the meantime, this reverts instead of silently
    /// handing out a fresh full allowance on top of what was already spent.
    function approveIfCurrent(address spender, uint256 expectedCurrent, uint256 newValue) external returns (bool) {
        uint256 current = allowance[msg.sender][spender];
        if (current != expectedCurrent) revert AllowanceChanged(current, expectedCurrent);
        _approve(msg.sender, spender, newValue, true);
        return true;
    }
}
