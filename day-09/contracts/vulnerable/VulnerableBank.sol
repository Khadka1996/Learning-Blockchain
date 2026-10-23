// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title VulnerableBank — DELIBERATELY BROKEN, for learning only
/// @notice Bug #1 (re-entrancy): it sends the ETH *before* it sets the balance to zero.
///         A contract receiving the ETH can call withdraw() again, and the old balance is still there.
contract VulnerableBank {
    mapping(address => uint256) public balanceOf;

    error NothingToWithdraw();
    error TransferFailed();

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        // INTERACTION first — control leaves this contract here.  ← the bug
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        // EFFECT last — too late: a re-entrant call already saw the old balance.
        balanceOf[msg.sender] = 0;
    }
}
