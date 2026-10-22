// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// TEST-ONLY helpers. Several are deliberately broken or hostile. Never deploy them.

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ERC165, IERC165} from "@openzeppelin/contracts/utils/introspection/ERC165.sol";

/// @dev Plain OpenZeppelin ERC-721 with an open mint/burn: the judge in differential tests.
contract ReferenceERC721 is ERC721 {
    address private immutable _minter;

    constructor() ERC721("Reference", "REF") {
        _minter = msg.sender;
    }

    function mint(address to, uint256 tokenId) external {
        require(msg.sender == _minter, "minter");
        _mint(to, tokenId);
    }

    function burn(uint256 tokenId) external {
        _update(address(0), tokenId, msg.sender); // OZ checks owner/approval
    }
}

/// @dev A contract that CAN hold NFTs (answers the hook correctly) and records what it got.
contract GoodReceiver is IERC721Receiver, IERC1155Receiver, ERC165 {
    uint256 public received721;
    bytes public lastData;

    function onERC721Received(address, address, uint256, bytes calldata data) external returns (bytes4) {
        received721 += 1;
        lastData = data;
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 id) public view override(ERC165, IERC165) returns (bool) {
        return id == type(IERC1155Receiver).interfaceId || super.supportsInterface(id);
    }
}

/// @dev A contract with no receiver hook at all: an NFT sent here would be stuck forever.
contract NoHookContract {
    function hello() external pure returns (string memory) {
        return "I cannot hold NFTs";
    }
}

/// @dev Answers the hook with the wrong 4 bytes.
contract WrongAnswerReceiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

/// @dev Refuses with its own message (which the token should pass on).
contract RefusingReceiver {
    error NoThanks();

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        revert NoThanks();
    }
}

/// @dev The WRONG way to write `mint`: limits are recorded AFTER `_safeMint` hands control
///      to the receiver, so a contract buyer can re-enter and break the per-wallet limit.
contract NaiveNFT is ERC721 {
    uint256 public constant MAX_PER_WALLET = 3;
    uint256 public totalMinted;
    mapping(address => uint256) public mintedBy;

    constructor() ERC721("Naive", "NAIVE") {}

    function mint(uint256 quantity) external {
        require(mintedBy[msg.sender] + quantity <= MAX_PER_WALLET, "wallet limit");
        for (uint256 i = 0; i < quantity; i++) {
            totalMinted += 1;
            _safeMint(msg.sender, totalMinted); // <-- calls the buyer back here
        }
        mintedBy[msg.sender] += quantity; // <-- too late: re-entrant calls saw the old count
    }
}

interface IMintable {
    function mint(uint256 quantity) external payable;
}

/// @dev Hostile buyer: every time it receives an NFT it tries to mint again.
contract ReentrantMinter is IERC721Receiver {
    IMintable public immutable target;
    uint256 public price;
    uint256 public reentries;
    uint256 public maxReentries;
    bool public lastReentryFailed;

    constructor(address target_) {
        target = IMintable(target_);
    }

    function attack(uint256 quantity, uint256 price_, uint256 maxReentries_) external payable {
        price = price_;
        maxReentries = maxReentries_;
        target.mint{value: price_ * quantity}(quantity);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (reentries < maxReentries) {
            reentries += 1;
            try target.mint{value: price}(1) {
                lastReentryFailed = false;
            } catch {
                lastReentryFailed = true;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}

/// @dev An owner that cannot receive ETH (no receive/fallback): withdraw must fail loudly.
contract EthRejectingOwner {
    function callWithdraw(address nft) external {
        (bool ok, bytes memory ret) = nft.call(abi.encodeWithSignature("withdraw()"));
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(32, ret), mload(ret))
            }
        }
    }
}

interface IOwnerOfApproved {
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
}

/// @dev Looks at the NFT contract FROM INSIDE the receiver hook (read-only re-entrancy probe).
contract ProbeReceiver is IERC721Receiver {
    address public seenOwner;
    address public seenApproved;
    uint256 public seenBalance;

    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        IOwnerOfApproved nft = IOwnerOfApproved(msg.sender);
        seenOwner = nft.ownerOf(tokenId);
        seenApproved = nft.getApproved(tokenId);
        seenBalance = nft.balanceOf(address(this));
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @dev A giveaway winner who buys more while the owner's giveaway mint is still running.
contract BuyDuringGiveaway is IERC721Receiver {
    IMintable public immutable target;
    bool private _done;

    constructor(address target_) payable {
        target = IMintable(target_);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        if (!_done) {
            _done = true;
            target.mint{value: 0.01 ether}(1);
        }
        return IERC721Receiver.onERC721Received.selector;
    }

    receive() external payable {}
}
