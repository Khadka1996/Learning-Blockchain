// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVault} from "../interfaces/IVault.sol";

/// @title VulnerableVault
/// @notice TEST ONLY. DELIBERATELY BROKEN. Never deploy, never copy.
/// @dev Same interface as LearningVault but it sends the ETH BEFORE it updates the
/// balance and has no guard. It exists so the tests can prove that ReentrantAttacker
/// really works: a test that "the attack fails" means nothing if the attack could not
/// succeed against a weak target (Day 09 studies this bug in depth).
contract VulnerableVault is IVault {
    mapping(address => uint256) public balances;

    function deposit() external payable override {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external override {
        require(balances[msg.sender] >= amount, "insufficient");
        // BUG: interaction before effects.
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
        unchecked {
            balances[msg.sender] -= amount; // BUG: updated too late (and unchecked)
        }
    }
}
