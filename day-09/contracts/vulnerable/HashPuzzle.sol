// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title HashPuzzle — DELIBERATELY BROKEN, for learning only
/// @notice Bug #4 (front-running): "the first person to send the word whose hash is `answerHash`
///         wins the prize". But a waiting transaction is PUBLIC. A bot reads the answer from the
///         victim's pending transaction, sends the same answer with a higher fee, and its copy is
///         put in the block first.
contract HashPuzzle {
    bytes32 public immutable answerHash;
    address public winner;

    event Solved(address indexed winner, uint256 prize);

    error AlreadySolved();
    error WrongAnswer();
    error TransferFailed();

    constructor(bytes32 answerHash_) payable {
        answerHash = answerHash_;
    }

    function solve(string calldata answer) external {
        if (winner != address(0)) revert AlreadySolved();
        if (keccak256(bytes(answer)) != answerHash) revert WrongAnswer();
        winner = msg.sender;
        uint256 prize = address(this).balance;
        emit Solved(msg.sender, prize);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: prize}("");
        if (!ok) revert TransferFailed();
    }
}
