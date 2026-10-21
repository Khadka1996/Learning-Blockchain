// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FalseReturnToken
/// @notice TEST ONLY. Instead of reverting when something is wrong, it moves nothing and returns
/// `false`. The standard allows this. Code that ignores the returned bool believes the
/// transfer happened.
contract FalseReturnToken {
    mapping(address => uint256) public balanceOf;

    constructor(uint256 initialSupply) {
        balanceOf[msg.sender] = initialSupply;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
