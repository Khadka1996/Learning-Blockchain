// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title L1Lockbox — the "home chain" side of a lock-and-mint bridge
/// @notice Users lock tokens here; validators watch the Deposit event and sign a message
///         that lets the user mint the same amount of a wrapped token on the other chain.
///         Every wrapped token in existence is an IOU for a token sitting in this box,
///         which is exactly why bridges are the biggest honeypots in crypto.
contract L1Lockbox is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAmount();
    error ZeroRecipient();

    IERC20 public immutable token;
    uint256 public nextDepositId;

    event Deposit(uint256 indexed depositId, address indexed from, address indexed to, uint256 amount);

    constructor(IERC20 token_) {
        token = token_;
    }

    /// @notice Lock `amount` tokens; `to` receives the wrapped tokens on the other chain.
    function deposit(address to, uint256 amount) external nonReentrant returns (uint256 depositId) {
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroRecipient();
        // Credit what actually arrived (fee-on-transfer tokens deliver less — Day 07 lesson).
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        depositId = nextDepositId++;
        emit Deposit(depositId, msg.sender, to, received);
    }
}
