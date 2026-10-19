// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ILayout {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice TEST ONLY: tries to withdraw again from inside the ETH transfer (re-entrancy).
contract ReentrantWithdrawer {
    ILayout public immutable TARGET;
    bool public reentered;
    uint256 public extraWithdrawn;
    uint256 private amount;

    constructor(ILayout target_) {
        TARGET = target_;
    }

    function attack() external payable {
        amount = msg.value;
        TARGET.deposit{value: msg.value}();
        TARGET.withdraw(msg.value);
    }

    receive() external payable {
        if (!reentered) {
            reentered = true;
            // Second withdraw must fail; swallow the error so we can report what happened.
            try TARGET.withdraw(amount) {
                extraWithdrawn = amount;
            } catch {}
        }
    }
}
