// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice TEST ONLY — the classic upgrade mistake: the two state variables are declared
///         in a different ORDER than in V1. The code compiles and the upgrade succeeds,
///         but every balance now reads from the wrong storage slot.
contract PiggyBankV2Broken is Initializable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    uint256 public totalDeposits; // was slot 1, now slot 0  <- WRONG
    mapping(address => uint256) public balanceOf; // was slot 0, now slot 1  <- WRONG

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    function version() external pure returns (string memory) {
        return "2.0.0-broken";
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
