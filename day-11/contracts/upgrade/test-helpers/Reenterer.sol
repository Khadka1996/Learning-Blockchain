// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IPiggy {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice TEST ONLY — tries to withdraw again from inside the ETH transfer.
contract Reenterer {
    IPiggy public immutable bank;
    uint256 public reentries;

    constructor(address b) {
        bank = IPiggy(b);
    }

    function attack() external payable {
        bank.deposit{value: msg.value}();
        bank.withdraw(msg.value);
    }

    receive() external payable {
        if (reentries == 0) {
            ++reentries;
            bank.withdraw(msg.value); // blocked by nonReentrant -> whole tx reverts
        }
    }
}
