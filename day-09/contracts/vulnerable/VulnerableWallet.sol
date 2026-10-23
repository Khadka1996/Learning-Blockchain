// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title VulnerableWallet — DELIBERATELY BROKEN, for learning only
/// @notice Bug #2 (missing access control): `initialize` is meant to run once, by the deployer,
///         but nothing stops ANYONE calling it later and making themselves the owner.
///         (The same kind of mistake caused the 2017 Parity multisig incidents:
///         about US$30M stolen in July and about US$150M frozen in November.)
contract VulnerableWallet {
    address public owner;

    error NotOwner();
    error TransferFailed();

    receive() external payable {}

    /// @dev BUG: no "only once" flag and no check on who calls.
    function initialize(address newOwner) external {
        owner = newOwner;
    }

    function withdrawAll(address payable to) external {
        if (msg.sender != owner) revert NotOwner();
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }
}
