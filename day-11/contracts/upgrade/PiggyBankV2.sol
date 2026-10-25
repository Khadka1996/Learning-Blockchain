// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PiggyBankV1} from "./PiggyBankV1.sol";

/// @title PiggyBankV2 — adds a per-user deposit cap and an emergency pause
/// @author Manish Khadka (Day 11 of Learning Blockchain)
/// @notice Upgrade-safe: inherits V1 unchanged and only APPENDS new variables
///         (slots 2 and 3). Withdrawals are never paused: users can always leave.
/// @custom:oz-upgrades-from PiggyBankV1
contract PiggyBankV2 is PiggyBankV1 {
    /// @notice Max ETH one user may hold in the box (slot 2). 0 = no cap.
    uint256 public maxPerUser;
    /// @notice When true, new deposits are refused (slot 3).
    bool public paused;

    error DepositsPaused();
    error CapExceeded(uint256 newBalance, uint256 cap);

    event Paused(bool isPaused);
    event CapChanged(uint256 cap);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice One-time setup for the new variables, called in the same tx as the upgrade.
    function initializeV2(uint256 cap) external reinitializer(2) onlyOwner {
        maxPerUser = cap;
        emit CapChanged(cap);
    }

    function deposit() external payable override {
        // QA E5: say "ZeroAmount" first, so a 0-value call is never blamed on the cap.
        if (msg.value == 0) revert ZeroAmount();
        if (paused) revert DepositsPaused();
        uint256 cap = maxPerUser;
        uint256 newBalance = balanceOf[msg.sender] + msg.value;
        if (cap != 0 && newBalance > cap) revert CapExceeded(newBalance, cap);
        _deposit();
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit Paused(p);
    }

    function setCap(uint256 cap) external onlyOwner {
        maxPerUser = cap;
        emit CapChanged(cap);
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }
}
