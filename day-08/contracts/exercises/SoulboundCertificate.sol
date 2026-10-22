// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title SoulboundCertificate — exercise 4: an NFT that cannot be sold or given away
/// @notice A degree or course certificate should stay with the person who earned it.
///         The issuer can award and revoke; the holder can delete their own; nobody can transfer.
///         (Day 15's capstone builds a full certificate dApp on this idea.)
contract SoulboundCertificate is ERC721, Ownable {
    uint256 public nextId = 1;

    error Soulbound();
    error NotHolderOrIssuer(address caller, uint256 tokenId);

    constructor() ERC721("Learning Certificate", "CERT") Ownable(msg.sender) {}

    function award(address to) external onlyOwner returns (uint256 id) {
        id = nextId++;
        _safeMint(to, id);
    }

    /// @notice The issuer revokes, or the holder throws their own certificate away.
    function burn(uint256 tokenId) external {
        address holder = _requireOwned(tokenId);
        if (msg.sender != holder && msg.sender != owner()) revert NotHolderOrIssuer(msg.sender, tokenId);
        _burn(tokenId);
    }

    /// @dev Every mint, transfer and burn goes through _update. Allow only mint (from 0) and burn (to 0).
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    /// @dev Approvals are pointless for a token that cannot move; refuse them so nobody is confused.
    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }
}
