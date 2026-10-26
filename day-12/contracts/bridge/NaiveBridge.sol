// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @title NaiveBridge — DO NOT USE. Three classic bridge bugs in 20 lines.
/// @notice  (1) The signed message has no deposit id, chain id or bridge address, so one
///              valid set of signatures can be replayed again and again (and on other chains).
///          (2) It counts signatures, not *different* signers: one validator signing twice
///              meets a 2-of-3 threshold alone.
///          (3) Nothing records that a deposit was already processed.
contract NaiveBridge {
    error NotEnoughSignatures();
    error NotValidator();

    IMintable public token;
    mapping(address => bool) public isValidator;
    uint256 public immutable threshold;

    constructor(address[] memory validators, uint256 threshold_) {
        for (uint256 i; i < validators.length; ++i) isValidator[validators[i]] = true;
        threshold = threshold_;
    }

    /// @dev Demo wiring: first caller wins. Tests deploy and wire in one go.
    function setToken(IMintable token_) external {
        if (address(token) == address(0)) token = token_;
    }

    function mint(address to, uint256 amount, bytes[] calldata sigs) external {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(keccak256(abi.encode(to, amount)));
        if (sigs.length < threshold) revert NotEnoughSignatures();
        for (uint256 i; i < sigs.length; ++i) {
            if (!isValidator[ECDSA.recover(digest, sigs[i])]) revert NotValidator();
        }
        token.mint(to, amount);
    }
}
