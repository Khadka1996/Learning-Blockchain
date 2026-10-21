// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title OZReference
/// @notice TEST ONLY. Plain OpenZeppelin ERC20 with the same constructor and `burn` as MiniToken.
/// The differential test runs identical random operations on both and demands identical results.
contract OZReference is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 initialSupply) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply);
    }

    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }
}
