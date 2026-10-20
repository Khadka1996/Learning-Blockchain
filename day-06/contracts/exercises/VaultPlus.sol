// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVault} from "../interfaces/IVault.sol";

/// @title VaultPlus
/// @notice Worked solutions for the Day 06 exercises 1, 2, 4 and 9 in one contract:
/// a deposit counter, a `getBalance` view, a minimum deposit with its own custom error,
/// and a two-step ownership transfer (which needs a NON-immutable owner).
/// @dev Educational. Not audited.
contract VaultPlus is IVault {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 public immutable minDeposit; // exercise 4
    address public owner; // exercise 9: must be mutable, an immutable cannot change
    address public pendingOwner;
    uint256 public depositCount; // exercise 1
    uint256 public totalDeposits;
    mapping(address => uint256) public balances;
    uint256 private _status;

    error NotOwner(address caller);
    error NotPendingOwner(address caller);
    error ZeroAddress();
    error ZeroAmount();
    error BelowMinimum(uint256 sent, uint256 minimum);
    error InsufficientBalance(uint256 available, uint256 requested);
    error TransferFailed();
    error ReentrantCall();

    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed account, uint256 amount, uint256 newBalance);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor(uint256 minimumDeposit) {
        minDeposit = minimumDeposit;
        _status = _NOT_ENTERED;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function deposit() external payable override {
        if (msg.value == 0) revert ZeroAmount();
        if (msg.value < minDeposit) revert BelowMinimum(msg.value, minDeposit);
        uint256 newBalance = balances[msg.sender] + msg.value;
        balances[msg.sender] = newBalance;
        totalDeposits += msg.value;
        depositCount += 1;
        emit Deposited(msg.sender, msg.value, newBalance);
    }

    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        uint256 remaining = available - amount;
        balances[msg.sender] = remaining;
        totalDeposits -= amount;
        emit Withdrawn(msg.sender, amount, remaining);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Exercise 2.
    function getBalance(address account) external view returns (uint256) {
        return balances[account];
    }

    /// @notice Exercise 9, step 1: the owner nominates a successor. Nothing changes yet.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Exercise 9, step 2: the nominee proves they control their address.
    /// This blocks the classic mistake of handing ownership to a typo or a dead address.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner(msg.sender);
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }
}
