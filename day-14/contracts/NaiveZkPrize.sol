// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface INaiveSecretVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[1] calldata publicSignals // [hash]
    ) external view returns (bool);
}

/// @title NaiveZkPrize — DELIBERATELY BROKEN, for the front-running demo. Do not use.
/// @notice The proof only says "someone knows the secret" and the prize goes to msg.sender.
///         A proof is just data: anyone who sees it in the mempool can copy it, send it with a
///         higher fee, and take the prize. Compare with ZkPrize, where the proof names the recipient.
contract NaiveZkPrize {
    INaiveSecretVerifier public immutable verifier;
    uint256 public immutable secretHash;
    bool public claimed;

    event Claimed(address indexed recipient, uint256 amount);

    error AlreadyClaimed();
    error InvalidProof();
    error TransferFailed();

    constructor(INaiveSecretVerifier verifier_, uint256 secretHash_) payable {
        verifier = verifier_;
        secretHash = secretHash_;
    }

    function claim(uint256[2] calldata a, uint256[2][2] calldata b, uint256[2] calldata c) external {
        if (claimed) revert AlreadyClaimed();
        if (!verifier.verifyProof(a, b, c, [secretHash])) revert InvalidProof();
        claimed = true;
        uint256 amount = address(this).balance;
        emit Claimed(msg.sender, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
