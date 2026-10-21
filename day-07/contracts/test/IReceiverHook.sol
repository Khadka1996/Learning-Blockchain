// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev ERC-777 style callback: a token calls this on a contract that just received tokens.
interface IReceiverHook {
    function onTokenReceived(address token, uint256 amount) external;
}
