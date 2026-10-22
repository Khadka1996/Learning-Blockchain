// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MappingAllowlist — exercise 7's comparison: the same list written into storage
contract MappingAllowlist is Ownable {
    mapping(address => bool) public allowed;

    constructor() Ownable(msg.sender) {}

    function addMany(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            allowed[accounts[i]] = true;
        }
    }
}
