// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ISafeBank {
    function deposit() external payable;
    function withdraw() external;
    function transferBalance(address to, uint256 amount) external;
}

/// @title CrossFunctionAttacker — test only
/// @notice Classic cross-function re-entrancy: while withdraw() is sending ETH, try to call
///         transferBalance() and move the (not yet zeroed, in a naive bank) balance to an accomplice.
contract CrossFunctionAttacker {
    ISafeBank public immutable bank;
    address public immutable accomplice = address(0xBEEF);
    uint256 public stake;
    bool public transferBlocked;
    bytes4 public blockedBy; // the 4-byte error selector the bank answered with

    constructor(address bank_) {
        bank = ISafeBank(bank_);
    }

    function attack() external payable {
        stake = msg.value;
        bank.deposit{value: msg.value}();
        bank.withdraw();
    }

    // Intentionally writes state inside a callback — this IS the attack being tested.
    // solhint-disable-next-line no-complex-fallback, reentrancy
    receive() external payable {
        // solhint-disable-next-line reentrancy
        try bank.transferBalance(accomplice, stake) {} catch (bytes memory reason) {
            // solhint-disable-next-line reentrancy
            transferBlocked = true;
            // solhint-disable-next-line reentrancy
            if (reason.length >= 4) blockedBy = bytes4(reason);
        }
    }
}

