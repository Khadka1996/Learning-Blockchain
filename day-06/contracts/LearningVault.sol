// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVault} from "./interfaces/IVault.sol";

/// @title LearningVault
/// @notice An educational ETH vault: deposit ETH, withdraw only your own balance.
/// It shows Solidity storage, modifiers, events, custom errors, access control
/// and checks-effects-interactions.
/// @dev A learning exercise, NOT an audited production vault.
contract LearningVault is IVault {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // Set once in the constructor and baked into the bytecode (no storage slot).
    // Lowercase on purpose: it is the public `owner()` getter, i.e. the contract's API.
    address public immutable owner;

    // Storage layout (read it with eth_getStorageAt, see src/demo.js):
    //   slot 0: paused          slot 2: balances (mapping base)
    //   slot 1: _status         slot 3: totalDeposits
    bool public paused;
    uint256 private _status;
    mapping(address account => uint256 amount) public balances;
    uint256 public totalDeposits;

    error NotOwner(address caller);
    error ZeroAmount();
    error ContractPaused();
    error InsufficientBalance(uint256 available, uint256 requested);
    error TransferFailed();
    error ReentrantCall();

    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed account, uint256 amount, uint256 newBalance);
    event PauseChanged(bool isPaused, address indexed changedBy);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    /// @dev The guard flips between 1 and 2, never back to 0. A slot that goes
    /// 0 -> 1 -> 0 costs a fresh 22,100-gas write on every call (Day 05).
    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    constructor() {
        owner = msg.sender;
        _status = _NOT_ENTERED;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @notice Deposit ETH into the caller's personal balance.
    function deposit() external payable override whenNotPaused {
        if (msg.value == 0) revert ZeroAmount();

        uint256 newBalance = balances[msg.sender] + msg.value;
        balances[msg.sender] = newBalance;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value, newBalance);
    }

    /// @notice Withdraw ETH from the caller's personal balance.
    /// @dev Works while paused on purpose: a pause stops new money coming in, but
    /// honest users can always take their own money out.
    function withdraw(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 available = balances[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);

        // Checks done. Effects (state + event) come BEFORE the external call.
        uint256 remaining = available - amount;
        balances[msg.sender] = remaining;
        totalDeposits -= amount;
        emit Withdrawn(msg.sender, amount, remaining);

        // Interaction last.
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /// @notice Pause or unpause new deposits (withdrawals always stay open).
    function setPaused(bool isPaused) external onlyOwner {
        if (paused == isPaused) return;
        paused = isPaused;
        emit PauseChanged(isPaused, msg.sender);
    }

    /// @notice True while the contract holds at least as much ETH as it owes users.
    /// @dev `>=`, not `==`: anyone can force-send ETH (selfdestruct), which is harmless.
    function solvencyCheck() external view returns (bool) {
        return address(this).balance >= totalDeposits;
    }
}
