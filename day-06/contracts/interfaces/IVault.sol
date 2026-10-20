// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title IVault
/// @notice The smallest vault interface: put ETH in, take your own ETH out.
/// @dev An `interface` has no storage and no function bodies, only the promise "any contract
/// that says `is IVault` must offer these functions". The test helpers use it to talk to
/// LearningVault and VulnerableVault without caring which one they are attacking.
interface IVault {
    function deposit() external payable;

    function withdraw(uint256 amount) external;
}
