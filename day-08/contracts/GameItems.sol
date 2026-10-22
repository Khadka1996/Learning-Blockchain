// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title GameItems — one ERC-1155 contract holding many kinds of items
/// @author Manish Khadka
/// @notice ERC-1155 is a table `(id, owner) => amount`. One id can behave like a coin
///         (GOLD: millions of identical units) and another like a unique NFT (CROWN: exactly 1).
/// @dev    Learning code. Not audited.
contract GameItems is ERC1155, ERC1155Supply, Ownable {
    uint256 public constant GOLD = 0; // fungible: many identical units
    uint256 public constant SWORD = 1; // semi-fungible: a limited edition
    uint256 public constant CROWN = 2; // non-fungible: exactly one exists

    /// @notice Hard limit per item id. 0 means "this id does not exist".
    mapping(uint256 id => uint256) public maxSupply;

    error UnknownItem(uint256 id);
    error ExceedsMaxSupply(uint256 id, uint256 requested, uint256 remaining);

    /// @param uri_ e.g. "ipfs://<cid>/{id}.json" — the client replaces {id} itself (EIP-1155 rule)
    constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {
        maxSupply[GOLD] = 1_000_000;
        maxSupply[SWORD] = 100;
        maxSupply[CROWN] = 1;
    }

    function mint(address to, uint256 id, uint256 amount) external onlyOwner {
        _checkCap(id, amount);
        _mint(to, id, amount, "");
    }

    /// @notice Mint several item types in ONE transaction (the reason ERC-1155 exists).
    function mintBatch(address to, uint256[] calldata ids, uint256[] calldata amounts) external onlyOwner {
        // The length check happens inside _mintBatch; caps are checked against the running total
        // so the same id twice in one batch cannot slip past its cap.
        uint256 n = ids.length < amounts.length ? ids.length : amounts.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 already = 0;
            for (uint256 j = 0; j < i; j++) {
                if (ids[j] == ids[i]) already += amounts[j];
            }
            _checkCap(ids[i], already + amounts[i]);
        }
        _mintBatch(to, ids, amounts, "");
    }

    function _checkCap(uint256 id, uint256 amount) private view {
        uint256 cap = maxSupply[id];
        if (cap == 0) revert UnknownItem(id);
        uint256 remaining = cap - totalSupply(id);
        if (amount > remaining) revert ExceedsMaxSupply(id, amount, remaining);
    }

    /// @dev ERC1155Supply must update totals on every mint/burn/transfer.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
