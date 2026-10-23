// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ForceFeeder — test only
/// @notice Sends ETH to a contract WITHOUT calling it: selfdestruct inside the constructor
///         still moves the balance (even after EIP-6780). The target cannot refuse.
contract ForceFeeder {
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
