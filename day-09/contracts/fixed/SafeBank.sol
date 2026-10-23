// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SafeBank — the fix for VulnerableBank
/// @notice Two independent defences:
///         1. Checks-Effects-Interactions: the balance is zeroed BEFORE the ETH leaves.
///         2. A re-entrancy lock (OpenZeppelin `nonReentrant`) on every function that moves value,
///            so a callback cannot enter withdraw() — or transferBalance() — while withdraw() is running.
///         (Named transferBalance, not transfer, so no wallet mistakes it for an ERC-20 token. QA S1.)
contract SafeBank is ReentrancyGuard {
    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Transferred(address indexed from, address indexed to, uint256 amount);

    error NothingToWithdraw();
    error TransferFailed();
    error InsufficientBalance(uint256 available, uint256 needed);
    error ZeroAddress();
    error InvalidRecipient();

    function deposit() external payable nonReentrant {
        balanceOf[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Move part of your balance to someone else inside the bank (no ETH leaves).
    function transferBalance(address to, uint256 amount) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        // The bank cannot call its own withdraw(), so a balance parked on its own address is lost forever (QA E1).
        if (to == address(this)) revert InvalidRecipient();
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        balanceOf[msg.sender] = available - amount;
        balanceOf[to] += amount;
        emit Transferred(msg.sender, to, amount);
    }

    function withdraw() external nonReentrant {
        // CHECKS
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        // EFFECTS
        balanceOf[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        // INTERACTIONS (last)
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
