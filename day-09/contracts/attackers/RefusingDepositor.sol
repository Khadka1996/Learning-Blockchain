// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISafeBank {
    function deposit() external payable;
    function withdraw() external;
    function transferBalance(address to, uint256 amount) external;
}

/// @title RefusingDepositor — test only: deposits, then refuses to receive ETH back.
contract RefusingDepositor {
    ISafeBank public immutable bank;

    constructor(address bank_) {
        bank = ISafeBank(bank_);
    }

    function depositToBank() external payable {
        bank.deposit{value: msg.value}();
    }

    function withdrawFromBank() external {
        bank.withdraw();
    }
}
