// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title CommitRevealPuzzle — the fix for HashPuzzle
/// @notice Commit–reveal in two transactions:
///         1. commit(c) with c = keccak256(abi.encode(yourAddress, answer, salt)) — a sealed envelope.
///            Nobody can read the answer from it, and it only works for YOUR address.
///         2. At least one block later, reveal(answer, salt). Copying this transaction is useless to a
///            bot: the bot has no commitment of its own from an earlier block that matches.
contract CommitRevealPuzzle {
    bytes32 public immutable answerHash;
    address public winner;

    struct Commitment {
        bytes32 hash;
        uint64 blockNumber;
    }
    mapping(address => Commitment) public commitments;

    event Committed(address indexed player, bytes32 commitment);
    event Solved(address indexed winner, uint256 prize);

    error AlreadySolved();
    error EmptyCommitment();
    error NoCommitment();
    error RevealTooEarly();
    error CommitmentMismatch();
    error WrongAnswer();
    error TransferFailed();

    constructor(bytes32 answerHash_) payable {
        answerHash = answerHash_;
    }

    /// @notice Helper so players (and tests) build the commitment exactly like the contract checks it.
    function makeCommitment(address player, string calldata answer, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(player, answer, salt));
    }

    function commit(bytes32 commitment) external {
        if (winner != address(0)) revert AlreadySolved();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        commitments[msg.sender] = Commitment(commitment, uint64(block.number));
        emit Committed(msg.sender, commitment);
    }

    function reveal(string calldata answer, bytes32 salt) external {
        if (winner != address(0)) revert AlreadySolved();
        Commitment memory c = commitments[msg.sender];
        if (c.hash == bytes32(0)) revert NoCommitment();
        // The commitment must be from an EARLIER block, so nobody can commit+reveal after seeing a reveal.
        if (block.number <= c.blockNumber) revert RevealTooEarly();
        if (makeCommitment(msg.sender, answer, salt) != c.hash) revert CommitmentMismatch();
        if (keccak256(bytes(answer)) != answerHash) revert WrongAnswer();

        winner = msg.sender;
        delete commitments[msg.sender];
        uint256 prize = address(this).balance;
        emit Solved(msg.sender, prize);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: prize}("");
        if (!ok) revert TransferFailed();
    }
}
