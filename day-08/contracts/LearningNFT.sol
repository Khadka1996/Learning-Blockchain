// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title LearningNFT — a small paid NFT collection, the OpenZeppelin way
/// @author Manish Khadka
/// @notice Fixed supply, a mint price, a per-wallet limit, metadata links and a royalty (ERC-2981).
/// @dev    Learning code. Not audited.
///         The interesting part is `mint`: `_safeMint` CALLS the receiver, so the receiver can
///         call `mint` again before the first call finishes. All limits are therefore checked
///         and recorded BEFORE any token is minted (checks → effects → interactions).
contract LearningNFT is ERC721, ERC2981, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 100;
    uint256 public constant MAX_PER_WALLET = 3;
    uint256 public constant MINT_PRICE = 0.01 ether;

    uint256 public totalMinted;
    mapping(address => uint256) public mintedBy;
    string private _base;
    /// @notice Once true, the metadata link can never change again (evening improvement).
    bool public metadataFrozen;

    event BaseURIChanged(string newBaseURI);
    event MetadataFrozen(string finalBaseURI);
    /// @dev EIP-4906: "token metadata changed, please re-read it" (signature from the EIP).
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    error InvalidQuantity(uint256 quantity);
    error SoldOut(uint256 requested, uint256 remaining);
    error WalletLimit(address wallet, uint256 alreadyMinted, uint256 requested);
    error WrongPayment(uint256 sent, uint256 required);
    error WithdrawFailed();
    error MetadataIsFrozen();
    error FundsStillHeld(uint256 balance);

    /// @param royaltyReceiver who receives royalties on resales
    /// @param royaltyBps royalty in basis points (500 = 5%); OpenZeppelin caps it at 10000
    constructor(string memory baseURI_, address royaltyReceiver, uint96 royaltyBps)
        ERC721("Learning NFT", "LNFT")
        Ownable(msg.sender)
    {
        _base = baseURI_;
        _setDefaultRoyalty(royaltyReceiver, royaltyBps);
    }

    /// @notice Pay `MINT_PRICE × quantity` and receive `quantity` new tokens (ids start at 1).
    function mint(uint256 quantity) external payable {
        // ---- checks
        if (quantity == 0 || quantity > MAX_PER_WALLET) revert InvalidQuantity(quantity);
        uint256 remaining = MAX_SUPPLY - totalMinted;
        if (quantity > remaining) revert SoldOut(quantity, remaining);
        uint256 already = mintedBy[msg.sender];
        if (already + quantity > MAX_PER_WALLET) revert WalletLimit(msg.sender, already, quantity);
        uint256 cost = MINT_PRICE * quantity;
        if (msg.value != cost) revert WrongPayment(msg.value, cost);

        // ---- effects (recorded before the receiver gets control)
        uint256 firstId = totalMinted + 1;
        totalMinted += quantity;
        mintedBy[msg.sender] = already + quantity;

        // ---- interactions (_safeMint may call msg.sender back)
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(msg.sender, firstId + i);
        }
    }

    /// @notice The owner can mint for free (giveaways), still inside MAX_SUPPLY.
    function ownerMint(address to, uint256 quantity) external onlyOwner {
        if (quantity == 0) revert InvalidQuantity(quantity);
        uint256 remaining = MAX_SUPPLY - totalMinted;
        if (quantity > remaining) revert SoldOut(quantity, remaining);
        uint256 firstId = totalMinted + 1;
        totalMinted += quantity;
        for (uint256 i = 0; i < quantity; i++) {
            _safeMint(to, firstId + i);
        }
    }

    /// @notice Move the metadata. Emits EIP-4906 so marketplaces know to re-read every token.
    function setBaseURI(string calldata newBase) external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        _base = newBase;
        emit BaseURIChanged(newBase);
        emit BatchMetadataUpdate(1, type(uint256).max);
    }

    /// @notice One-way switch: after this, nobody (not even the owner) can change what the NFTs show.
    function freezeMetadata() external onlyOwner {
        if (metadataFrozen) revert MetadataIsFrozen();
        metadataFrozen = true;
        emit MetadataFrozen(_base);
    }

    /// @notice Giving up ownership while mint income is inside would lock that ETH forever
    ///         (only the owner can withdraw). Withdraw first. (Evening audit finding E1.)
    function renounceOwnership() public override onlyOwner {
        uint256 held = address(this).balance;
        if (held != 0) revert FundsStillHeld(held);
        super.renounceOwnership();
    }

    /// @notice Send the mint income to the owner. Pull pattern: income waits here until collected.
    function withdraw() external onlyOwner {
        (bool ok,) = payable(owner()).call{value: address(this).balance}("");
        if (!ok) revert WithdrawFailed();
    }

    /// @notice ".../7.json" — one metadata file per token.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(_base, tokenId.toString(), ".json");
    }

    /// @dev Both parents implement ERC-165; we must say "yes" to both sets, plus EIP-4906.
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns (bool) {
        return interfaceId == bytes4(0x49064906) || super.supportsInterface(interfaceId); // EIP-4906
    }
}
