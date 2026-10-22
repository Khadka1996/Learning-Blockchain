// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev The receiver interface from EIP-721. A contract that can hold NFTs answers
///      this call with its own selector; anything else means "I cannot hold NFTs".
interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title MiniNFT — an ERC-721 written from scratch, for learning
/// @author Manish Khadka
/// @notice An NFT is a table `tokenId => owner` plus rules for who may move each row.
///         Same error names as OpenZeppelin 5 (ERC-6093) so tests can compare the two.
/// @dev    Learning code. Not audited. Do not put real value in it.
contract MiniNFT {
    // ---------------------------------------------------------------- events
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // ---------------------------------------------------------------- errors (ERC-6093)
    error ERC721InvalidOwner(address owner);
    error ERC721NonexistentToken(uint256 tokenId);
    error ERC721IncorrectOwner(address sender, uint256 tokenId, address owner);
    error ERC721InvalidSender(address sender);
    error ERC721InvalidReceiver(address receiver);
    error ERC721InsufficientApproval(address operator, uint256 tokenId);
    error ERC721InvalidApprover(address approver);
    error ERC721InvalidOperator(address operator);
    error NotMinter(address caller);

    // ---------------------------------------------------------------- storage
    string public name;
    string public symbol;
    address public immutable minter;
    string private _baseURI;

    mapping(uint256 tokenId => address) private _owners;
    mapping(address owner => uint256) private _balances;
    mapping(uint256 tokenId => address) private _tokenApprovals;
    mapping(address owner => mapping(address operator => bool)) private _operatorApprovals;

    constructor(string memory name_, string memory symbol_, string memory baseURI_) {
        name = name_;
        symbol = symbol_;
        _baseURI = baseURI_;
        minter = msg.sender;
    }

    // ---------------------------------------------------------------- ERC-165
    /// @notice "Which standards do you speak?" Wallets and marketplaces ask this first.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }

    // ---------------------------------------------------------------- reads
    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ERC721InvalidOwner(address(0));
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address owner = _owners[tokenId];
        if (owner == address(0)) revert ERC721NonexistentToken(tokenId);
        return owner;
    }

    /// @notice Where the picture and description live (off-chain JSON). The chain stores only the link.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId); // reverts for a token that does not exist
        return string.concat(_baseURI, _toString(tokenId));
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner, address operator) public view returns (bool) {
        return _operatorApprovals[owner][operator];
    }

    // ---------------------------------------------------------------- permissions
    /// @notice Let ONE address move ONE token. Cleared automatically when the token moves.
    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !isApprovedForAll(owner, msg.sender)) {
            revert ERC721InvalidApprover(msg.sender);
        }
        _tokenApprovals[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    /// @notice Let an operator (e.g. a marketplace) move EVERY token you own, now and later.
    function setApprovalForAll(address operator, bool approved) external {
        if (operator == address(0)) revert ERC721InvalidOperator(operator);
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    // ---------------------------------------------------------------- transfers
    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert ERC721InvalidReceiver(address(0));
        address owner = ownerOf(tokenId);
        // Permission first, then `from`: the same error order as OpenZeppelin
        // (a difference found by the shared test suite, see QA.md M1).
        if (msg.sender != owner && _tokenApprovals[tokenId] != msg.sender && !isApprovedForAll(owner, msg.sender)) {
            revert ERC721InsufficientApproval(msg.sender, tokenId);
        }
        if (owner != from) revert ERC721IncorrectOwner(from, tokenId, owner);

        delete _tokenApprovals[tokenId]; // the old one-token approval must not survive the sale
        unchecked {
            _balances[from] -= 1; // cannot underflow: `from` owns this token
            _balances[to] += 1; // cannot overflow: there are fewer than 2^256 tokens
        }
        _owners[tokenId] = to;
        emit Transfer(from, to, tokenId);
    }

    /// @notice Like transferFrom, but refuses to send into a contract that cannot hold NFTs.
    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        _checkOnERC721Received(from, to, tokenId, data);
    }

    // ---------------------------------------------------------------- mint / burn
    function mint(address to, uint256 tokenId) external {
        if (msg.sender != minter) revert NotMinter(msg.sender);
        if (to == address(0)) revert ERC721InvalidReceiver(address(0));
        if (_owners[tokenId] != address(0)) revert ERC721InvalidSender(address(0)); // already minted
        unchecked {
            _balances[to] += 1;
        }
        _owners[tokenId] = to;
        emit Transfer(address(0), to, tokenId);
    }

    /// @notice Destroy a token. Only its owner or someone they approved may do this.
    function burn(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && _tokenApprovals[tokenId] != msg.sender && !isApprovedForAll(owner, msg.sender)) {
            revert ERC721InsufficientApproval(msg.sender, tokenId);
        }
        delete _tokenApprovals[tokenId];
        unchecked {
            _balances[owner] -= 1;
        }
        delete _owners[tokenId];
        emit Transfer(owner, address(0), tokenId);
    }

    // ---------------------------------------------------------------- internals
    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return; // a normal wallet can always hold NFTs
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 retval) {
            if (retval != IERC721Receiver.onERC721Received.selector) revert ERC721InvalidReceiver(to);
        } catch (bytes memory reason) {
            if (reason.length == 0) revert ERC721InvalidReceiver(to);
            // The only way to re-throw raw revert data unchanged (same as OpenZeppelin).
            // solhint-disable-next-line no-inline-assembly
            assembly ("memory-safe") {
                revert(add(32, reason), mload(reason)) // bubble up the receiver's own error
            }
        }
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits = 0;
        for (uint256 v = value; v != 0; v /= 10) digits++;
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
