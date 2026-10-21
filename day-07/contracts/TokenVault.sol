// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TokenVault
/// @notice Day 06's vault, for ANY ERC-20. It is the standard example of a contract that
/// spends other people's tokens through an allowance (`approve` then `transferFrom`).
/// @dev Handles the real-world quirks of ERC-20 tokens:
/// - tokens that return nothing (USDT) or `false` instead of reverting -> `SafeERC20`
/// - tokens that take a fee on transfer -> credit what ARRIVED, not what was requested
/// - permit front-running -> `depositWithPermit` does not fail if someone already used the signature
/// NOT supported (documented): rebasing tokens whose balances change by themselves.
/// Educational, NOT audited.
contract TokenVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    mapping(IERC20 token => mapping(address account => uint256 amount)) public balances;
    mapping(IERC20 token => uint256 amount) public totalDeposits;

    error ZeroAmount();
    error NothingReceived();
    error InsufficientBalance(uint256 available, uint256 requested);

    /// `requested` is what the user asked for, `received` what really arrived (differs for fee tokens).
    event Deposited(IERC20 indexed token, address indexed account, uint256 requested, uint256 received);
    event Withdrawn(IERC20 indexed token, address indexed account, uint256 amount);

    /// @notice Pull `amount` of `token` from the caller. The caller must `approve` this vault first.
    function deposit(IERC20 token, uint256 amount) external nonReentrant returns (uint256 received) {
        return _deposit(token, amount);
    }

    /// @notice Approve and deposit in ONE transaction using an EIP-2612 signature.
    function depositWithPermit(
        IERC20 token,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 received) {
        // Anyone who sees the signature in the mempool can submit `permit` first. Then OUR
        // call would revert (nonce already used) and the user's deposit would be blocked.
        // So a failing permit is ignored; if the allowance is really missing, the
        // transferFrom below reverts with a clear error anyway.
        try IERC20Permit(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
        return _deposit(token, amount);
    }

    /// @notice Take back some of your own deposit.
    function withdraw(IERC20 token, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[token][msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);

        // Effects before the external call (Day 06). Even a callback cannot see stale numbers.
        balances[token][msg.sender] = available - amount;
        totalDeposits[token] -= amount;
        emit Withdrawn(token, msg.sender, amount);

        token.safeTransfer(msg.sender, amount);
    }

    /// @notice True while the vault holds at least as much of `token` as it owes.
    function solvencyCheck(IERC20 token) external view returns (bool) {
        return token.balanceOf(address(this)) >= totalDeposits[token];
    }

    function _deposit(IERC20 token, uint256 amount) private returns (uint256 received) {
        if (amount == 0) revert ZeroAmount();

        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        received = token.balanceOf(address(this)) - before; // what REALLY arrived
        if (received == 0) revert NothingReceived();

        balances[token][msg.sender] += received;
        totalDeposits[token] += received;
        emit Deposited(token, msg.sender, amount, received);
    }
}
