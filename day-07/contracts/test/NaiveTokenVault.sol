// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title NaiveTokenVault
/// @notice TEST ONLY. DELIBERATELY BROKEN. Never deploy, never copy.
/// @dev It credits the `amount` the user ASKED for, not what ARRIVED, and ignores the bool that
/// `transfer`/`transferFrom` return. With a fee-on-transfer token it ends up owing more than it
/// holds (the last user to withdraw is robbed). It is the control for TokenVault's tests.
contract NaiveTokenVault {
    mapping(IERC20 => mapping(address => uint256)) public balances;

    function deposit(IERC20 token, uint256 amount) external {
        token.transferFrom(msg.sender, address(this), amount);
        balances[token][msg.sender] += amount; // BUG: trusts `amount`
    }

    function withdraw(IERC20 token, uint256 amount) external {
        require(balances[token][msg.sender] >= amount, "insufficient");
        balances[token][msg.sender] -= amount;
        token.transfer(msg.sender, amount);
    }
}
