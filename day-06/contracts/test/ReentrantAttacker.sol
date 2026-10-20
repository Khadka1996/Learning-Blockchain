// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVault} from "../interfaces/IVault.sol";

/// @title ReentrantAttacker
/// @notice TEST ONLY. Deposits `msg.value`, withdraws it, and from `receive()` tries to
/// withdraw again while the first withdrawal is still running.
contract ReentrantAttacker {
    uint256 public constant MAX_REENTRIES = 10;

    IVault public immutable target;
    uint256 public stake;
    uint256 public reentries;
    bool public lastReentryFailed;
    bytes4 public lastRevertSelector; // which custom error refused the re-entry

    constructor(address vault) {
        target = IVault(vault);
    }

    function attack() external payable {
        stake = msg.value;
        target.deposit{value: msg.value}();
        target.withdraw(msg.value);
    }

    receive() external payable {
        if (reentries < MAX_REENTRIES && address(target).balance >= stake) {
            reentries += 1;
            // try/catch so a refused re-entry does not undo the whole attack call:
            // we want to observe the refusal, not just see everything revert.
            try target.withdraw(stake) {} catch (bytes memory reason) {
                lastReentryFailed = true;
                if (reason.length >= 4) lastRevertSelector = bytes4(reason);
            }
        }
    }
}
