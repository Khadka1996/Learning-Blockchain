// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title KingOfTheHill — DELIBERATELY BROKEN, for learning only
/// @notice Bug #5 (denial of service): to become king you pay more than the current king,
///         and the contract immediately REFUNDS the old king. If the old king is a contract that
///         refuses ETH, every refund fails, so nobody can ever take the throne again.
contract KingOfTheHill {
    address public king;
    uint256 public prize;

    event NewKing(address indexed king, uint256 prize);

    error BidTooLow(uint256 current, uint256 offered);
    error RefundFailed();

    function claimThrone() external payable {
        if (msg.value <= prize) revert BidTooLow(prize, msg.value);
        address previousKing = king;
        uint256 previousPrize = prize;
        king = msg.sender;
        prize = msg.value;
        emit NewKing(msg.sender, msg.value);
        if (previousKing != address(0)) {
            // PUSH payment: one stubborn receiver blocks everybody.  ← the bug
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok, ) = previousKing.call{value: previousPrize}("");
            if (!ok) revert RefundFailed();
        }
    }
}
