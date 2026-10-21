// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title GhostToken
/// @notice TEST ONLY. `transferFrom` and `transfer` report success (`true`) but move NOTHING.
/// Unlike FalseReturnToken it does not even say "false", so only a vault that checks what
/// actually ARRIVED notices.
contract GhostToken {
    mapping(address => uint256) public balanceOf;

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }
}
