// SPDX-License-Identifier: MIT
// solhint-disable one-contract-per-file
// Test fixtures only — never deployed outside tests.
pragma solidity 0.8.24;


import {TipJar} from "../TipJar.sol";

/// @dev Test fixture: a TipJar OWNER that tries to re-enter withdraw() when paid.
contract ReentrantOwner {
    TipJar public immutable jar;
    uint256 public reentryAttempts;
    bool public reentrySucceeded;

    constructor() {
        jar = new TipJar(); // this contract is the owner
    }

    function pull() external {
        jar.withdraw(payable(address(this)));
    }

    receive() external payable {
        if (reentryAttempts == 0) {
            reentryAttempts = 1;
            // The jar is already empty, so this must revert (NothingToWithdraw).
            try jar.withdraw(payable(address(this))) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }
}

/// @dev Test fixture: a recipient that refuses ETH.
contract RejectEther {
    error NoThanks();

    receive() external payable {
        revert NoThanks();
    }
}
