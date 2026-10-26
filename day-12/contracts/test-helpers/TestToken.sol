// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Plain token for tests and the demo; the deployer gets the whole supply.
contract TestToken is ERC20 {
    constructor(uint256 supply) ERC20("Test USD", "tUSD") {
        _mint(msg.sender, supply);
    }
}
