// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title LeakyBank — BROKEN ON PURPOSE (Challenge exercise 6)
/// @notice Looks like SafeBank, but transferBalance forgets to subtract from the sender,
///         so ETH is created out of thin air. The fuzz script finds it without being told where to look.
contract LeakyBank {
    mapping(address => uint256) public balanceOf;

    error NothingToWithdraw();
    error TransferFailed();
    error InsufficientBalance(uint256 available, uint256 needed);

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transferBalance(address to, uint256 amount) external {
        uint256 available = balanceOf[msg.sender];
        if (amount > available) revert InsufficientBalance(available, amount);
        // BUG: the line `balanceOf[msg.sender] = available - amount;` is missing.
        balanceOf[to] += amount;
    }

    function withdraw() external {
        uint256 amount = balanceOf[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        balanceOf[msg.sender] = 0;
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
