// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/// @title AllowlistNFT — exercise 6: a presale only for addresses on a list, using ONE Merkle root
/// @notice Storing 1,000 addresses on-chain is expensive. Store the Merkle root (Day 04) instead;
///         each buyer brings a proof that their address is a leaf of that tree.
contract AllowlistNFT is ERC721, Ownable {
    bytes32 public immutable allowlistRoot;
    uint256 public nextId = 1;
    mapping(address => bool) public claimed;

    error NotOnAllowlist(address account);
    error AlreadyClaimed(address account);

    constructor(bytes32 root) ERC721("Allowlist NFT", "ALLOW") Ownable(msg.sender) {
        allowlistRoot = root;
    }

    /// @dev The leaf is hashed TWICE (OpenZeppelin's advice): a 64-byte inner node can then never be
    ///      passed off as a leaf ("second preimage" attack).
    function leaf(address account) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account))));
    }

    function claim(bytes32[] calldata proof) external {
        if (claimed[msg.sender]) revert AlreadyClaimed(msg.sender);
        if (!MerkleProof.verifyCalldata(proof, allowlistRoot, leaf(msg.sender))) revert NotOnAllowlist(msg.sender);
        claimed[msg.sender] = true; // effects before _safeMint calls the claimer back
        _safeMint(msg.sender, nextId++);
    }
}
