// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title TxOriginWallet — DELIBERATELY BROKEN, for learning only
/// @notice Bug #3 (tx.origin authentication): `tx.origin` is the PERSON who started the transaction,
///         not the contract that is calling right now. If the owner is tricked into calling ANY
///         malicious contract, that contract can call this wallet and pass the owner check.
contract TxOriginWallet {
    address public immutable owner;

    error NotOwner();
    error TransferFailed();

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function pay(address payable to, uint256 amount) external {
        // solhint-disable-next-line avoid-tx-origin
        if (tx.origin != owner) revert NotOwner(); // ← the bug: should be msg.sender
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
