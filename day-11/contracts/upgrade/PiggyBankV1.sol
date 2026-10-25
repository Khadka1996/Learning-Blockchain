// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/// @title PiggyBankV1 — an ETH savings box that lives behind a UUPS proxy
/// @author Manish Khadka (Day 11 of Learning Blockchain)
/// @notice Users deposit and withdraw their own ETH. The owner can upgrade the LOGIC,
///         but the money and balances stay in the proxy's storage.
/// @dev Rules for upgradeable code:
///      - no constructor logic (the proxy never runs it) -> use initialize()
///      - lock the implementation with _disableInitializers()
///      - NEVER reorder, remove or retype state variables in later versions; only append
///      Ownership uses two steps (QA L1): a typo in transferOwnership can't lose upgrade control.
///      OZ 5 parents use ERC-7201 namespaced storage, so our variables start at slot 0.
contract PiggyBankV1 is Initializable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    /// @notice ETH each user has saved (slot 0)
    mapping(address => uint256) public balanceOf;
    /// @notice Sum of all balances (slot 1)
    uint256 public totalDeposits;

    error ZeroAmount();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Nobody can ever initialize (and take over) the bare implementation contract.
        _disableInitializers();
    }

    /// @notice Runs once, through the proxy, instead of a constructor.
    function initialize(address initialOwner) public initializer {
        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    function deposit() external payable virtual {
        _deposit();
    }

    function _deposit() internal {
        if (msg.value == 0) revert ZeroAmount();
        balanceOf[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /// @notice Withdraw your own ETH. Checks-effects-interactions + re-entrancy lock.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = balanceOf[msg.sender];
        if (amount > bal) revert InsufficientBalance(amount, bal);
        balanceOf[msg.sender] = bal - amount;
        totalDeposits -= amount;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function version() external pure virtual returns (string memory) {
        return "1.0.0";
    }

    /// @dev The ONLY gate on upgrades. Forget `onlyOwner` here and anyone can replace the code.
    function _authorizeUpgrade(address) internal override onlyOwner {}
}
