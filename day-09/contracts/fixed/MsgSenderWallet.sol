// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MsgSenderWallet — the fix for TxOriginWallet
/// @notice Checks `msg.sender` (the IMMEDIATE caller). A phishing contract the owner calls is
///         itself the msg.sender when it calls us, so it fails the check.
contract MsgSenderWallet {
    address public immutable owner;

    event Sent(address indexed to, uint256 amount);

    error NotOwner();
    error ZeroAddress();
    error TransferFailed();

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function pay(address payable to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        emit Sent(to, amount);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
