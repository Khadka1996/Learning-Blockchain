// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IWrapped {
    function mint(address to, uint256 amount) external;
}

/// @title SafeBridge — the destination-chain side of a lock-and-mint bridge (M-of-N validators)
/// @notice Mints wrapped tokens only when at least `threshold` DIFFERENT validators signed the
///         exact deposit. The signed message binds everything that matters:
///
///   keccak256(abi.encode(MINT_TYPEHASH, block.chainid, address(this), srcChainId, depositId, to, amount))
///
///   - block.chainid + address(this) → a signature for this bridge on this chain is useless elsewhere
///   - srcChainId + depositId         → each lock on the source chain can be minted exactly once
///   - to + amount                    → nobody can redirect or inflate the mint
///
///  Signatures must be ordered by signer address (strictly increasing), which rejects the same
///  validator twice in O(n) without a mapping.
///
///  What this contract can NOT protect against: `threshold` validator keys being stolen. Then
///  the attacker signs fake deposits and mints unbacked tokens (Ronin 2022: 5 of 9 keys, ~$600M).
///  That is a trust assumption, stated in the README, not a code bug.
contract SafeBridge {
    error BadConfig();
    error WrongSourceChain(uint256 srcChainId);
    error AlreadyProcessed(uint256 depositId);
    error NotEnoughSignatures(uint256 got, uint256 needed);
    error NotValidatorOrUnsorted(address signer);
    error ZeroAmount();
    error ZeroRecipient();
    error TokenAlreadySet();
    error NotDeployer();

    bytes32 public constant MINT_TYPEHASH =
        keccak256("Mint(uint256 dstChainId,address bridge,uint256 srcChainId,uint256 depositId,address to,uint256 amount)");

    uint256 public immutable srcChainId;
    uint256 public immutable threshold;
    address private immutable deployer;
    IWrapped public token;

    mapping(address => bool) public isValidator;
    mapping(uint256 => bool) public processed; // depositId => minted?

    event Minted(uint256 indexed depositId, address indexed to, uint256 amount);

    constructor(uint256 srcChainId_, address[] memory validators, uint256 threshold_) {
        if (threshold_ == 0 || threshold_ > validators.length) revert BadConfig();
        // Majority at least: a 1-of-N bridge is one stolen laptop away from disaster.
        if (threshold_ * 2 <= validators.length) revert BadConfig();
        for (uint256 i; i < validators.length; ++i) {
            address v = validators[i];
            if (v == address(0) || isValidator[v]) revert BadConfig();
            isValidator[v] = true;
        }
        srcChainId = srcChainId_;
        threshold = threshold_;
        deployer = msg.sender;
    }

    /// @notice One-time wiring (the token needs the bridge address in its constructor).
    function setToken(IWrapped token_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(token) != address(0)) revert TokenAlreadySet();
        if (address(token_) == address(0)) revert BadConfig();
        token = token_;
    }

    /// @notice The digest validators sign (as an Ethereum "signed message").
    function mintDigest(uint256 srcChainId_, uint256 depositId, address to, uint256 amount)
        public
        view
        returns (bytes32)
    {
        return MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(MINT_TYPEHASH, block.chainid, address(this), srcChainId_, depositId, to, amount))
        );
    }

    function mint(uint256 srcChainId_, uint256 depositId, address to, uint256 amount, bytes[] calldata sigs)
        external
    {
        if (srcChainId_ != srcChainId) revert WrongSourceChain(srcChainId_);
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroRecipient();
        if (processed[depositId]) revert AlreadyProcessed(depositId);
        if (sigs.length < threshold) revert NotEnoughSignatures(sigs.length, threshold);

        bytes32 digest = mintDigest(srcChainId_, depositId, to, amount);
        address last = address(0); // signers must be strictly increasing → no duplicates
        for (uint256 i; i < sigs.length; ++i) {
            address signer = ECDSA.recover(digest, sigs[i]); // OZ rejects malleable (high-s) sigs
            if (!isValidator[signer] || signer <= last) revert NotValidatorOrUnsorted(signer);
            last = signer;
        }

        processed[depositId] = true; // effects before the external call
        emit Minted(depositId, to, amount);
        token.mint(to, amount);
    }
}
