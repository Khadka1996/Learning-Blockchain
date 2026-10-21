// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title FeeToken
/// @notice TEST ONLY. A "fee on transfer" token: the receiver gets 1% LESS than the sender sent
/// (the fee is burned). Real tokens like this exist; a vault that trusts `amount` is wrong.
contract FeeToken is ERC20 {
    uint256 public constant FEE_BPS = 100; // 1.00 %

    constructor(uint256 initialSupply) ERC20("Fee Token", "FEE") {
        _mint(msg.sender, initialSupply);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (value * FEE_BPS) / 10_000;
            super._update(from, address(0), fee); // burn the fee
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}
