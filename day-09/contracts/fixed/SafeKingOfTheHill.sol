// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SafeKingOfTheHill — the fix for KingOfTheHill
/// @notice PULL payments: the old king's refund is only RECORDED. Each person withdraws their
///         own money later. A receiver that refuses ETH now only hurts itself.
contract SafeKingOfTheHill is ReentrancyGuard {
    address public king;
    uint256 public prize;
    mapping(address => uint256) public pendingReturns;

    event NewKing(address indexed king, uint256 prize);
    event Withdrawn(address indexed who, uint256 amount);

    error BidTooLow(uint256 current, uint256 offered);
    error NothingToWithdraw();
    error TransferFailed();

    function claimThrone() external payable nonReentrant {
        if (msg.value <= prize) revert BidTooLow(prize, msg.value);
        if (king != address(0)) pendingReturns[king] += prize;
        king = msg.sender;
        prize = msg.value;
        emit NewKing(msg.sender, msg.value);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingReturns[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
