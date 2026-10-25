// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice TEST ONLY — a plain contract with no UUPS logic. Upgrading to it would
///         "brick" the proxy forever (no upgrade function left), so UUPS must refuse it.
contract NotUpgradeable {
    function version() external pure returns (string memory) {
        return "brick";
    }
}
