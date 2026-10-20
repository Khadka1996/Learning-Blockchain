// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ForceSender
/// @notice TEST ONLY. Pushes ETH into any address, even one with no receive() function,
/// by self-destructing in its constructor. Shows why code must never assume
/// `address(this).balance` equals the sum of the deposits it tracked.
contract ForceSender {
    // solhint-disable-next-line avoid-suicide
    constructor(address payable target) payable {
        selfdestruct(target);
    }
}
