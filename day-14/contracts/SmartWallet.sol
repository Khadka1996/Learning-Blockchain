// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {BaseAccount} from "@account-abstraction/contracts/core/BaseAccount.sol";
import {SIG_VALIDATION_FAILED, SIG_VALIDATION_SUCCESS} from "@account-abstraction/contracts/core/Helpers.sol";
import {UserOperationLib} from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title SmartWallet — an ERC-4337 smart-contract wallet with a daily limit and guardian recovery.
/// @notice A normal wallet (EOA) is just a key: lose it and the money is gone, steal it and you can
///         spend everything at once. A smart wallet is a CONTRACT that holds the money and decides
///         its own rules. This one has three:
///           1. The owner's signature is needed for every action (checked in validateUserOp).
///           2. At most `dailyLimit` wei of ETH can leave per day (checked in execute).
///           3. A `guardian` (a friend, a second device) can hand the wallet to a new owner after a
///              2-day delay, and the current owner can cancel that during the delay.
/// @dev The flow (ERC-4337 v0.7):
///        owner signs a UserOperation → bundler calls EntryPoint.handleOps
///        → EntryPoint calls validateUserOp (signature, nonce, pay gas) → EntryPoint calls execute.
contract SmartWallet is BaseAccount {
    using UserOperationLib for PackedUserOperation;

    uint256 public constant RECOVERY_DELAY = 2 days;
    /// @notice The most ONE operation may cost this wallet in gas (QA M1). Without a cap, a thief
    ///         with the key sets an absurd fee: validateUserOp pays it out BEFORE execute, so the
    ///         daily limit never sees it. 0.01 ETH ≈ 300,000 gas at 33 gwei.
    uint256 public constant MAX_GAS_COST_PER_OP = 0.01 ether;

    IEntryPoint private immutable _entryPoint;

    address public owner;
    address public immutable guardian; // fixed for life (see QA known issue K2)

    uint256 public dailyLimit;
    uint256 public spentToday;
    uint256 public currentDay; // block.timestamp / 1 days when spentToday was last reset

    address public pendingOwner;
    uint256 public recoveryReadyAt;

    event Executed(address indexed dest, uint256 value, bytes data);
    event DailyLimitChanged(uint256 oldLimit, uint256 newLimit);
    event RecoveryStarted(address indexed newOwner, uint256 readyAt);
    event RecoveryCancelled(address indexed cancelledOwner);
    event OwnerChanged(address indexed oldOwner, address indexed newOwner);

    error NotAuthorized(address caller);
    error ZeroAddress();
    error DailyLimitExceeded(uint256 wanted, uint256 remaining);
    error CallFailed(bytes reason);
    error NoRecoveryPending();
    error RecoveryNotReady(uint256 readyAt);
    error OnlyLowering(uint256 current, uint256 wanted);
    error GasCostTooHigh(uint256 maxCost, uint256 cap);
    error ForbiddenTarget(address target);

    modifier onlyEntryPointOrOwner() {
        if (msg.sender != address(_entryPoint) && msg.sender != owner) revert NotAuthorized(msg.sender);
        _;
    }

    constructor(IEntryPoint entryPoint_, address owner_, address guardian_, uint256 dailyLimit_) {
        if (address(entryPoint_) == address(0) || owner_ == address(0) || guardian_ == address(0)) revert ZeroAddress();
        _entryPoint = entryPoint_;
        owner = owner_;
        guardian = guardian_;
        dailyLimit = dailyLimit_;
    }

    receive() external payable {}

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    // ------------------------------------------------------------------ actions

    /// @notice Send ETH and/or call a contract. Called by the EntryPoint (after validateUserOp)
    ///         or directly by the owner as a normal transaction.
    function execute(address dest, uint256 value, bytes calldata data) external onlyEntryPointOrOwner {
        // QA M1: EntryPoint.withdrawTo would move this wallet's gas deposit out with value = 0,
        // past the daily limit. Nobody needs execute() for the EntryPoint: anyone can depositTo().
        if (dest == address(_entryPoint)) revert ForbiddenTarget(dest);
        _spend(value);
        emit Executed(dest, value, data); // before the call (Slither reentrancy-events); reverted with it on failure
        (bool ok, bytes memory ret) = dest.call{value: value}(data);
        if (!ok) revert CallFailed(ret);
    }

    /// @notice Guardian may set any limit; the wallet itself (owner via execute) may only LOWER it,
    ///         so a thief with the owner key cannot raise the limit and empty the wallet.
    function setDailyLimit(uint256 newLimit) external {
        if (msg.sender == address(this)) {
            if (newLimit > dailyLimit) revert OnlyLowering(dailyLimit, newLimit);
        } else if (msg.sender != guardian) {
            revert NotAuthorized(msg.sender);
        }
        emit DailyLimitChanged(dailyLimit, newLimit);
        dailyLimit = newLimit;
    }

    /// @notice How much ETH can still leave today.
    function remainingToday() public view returns (uint256) {
        if (block.timestamp / 1 days != currentDay) return dailyLimit;
        return spentToday >= dailyLimit ? 0 : dailyLimit - spentToday;
    }

    // ------------------------------------------------------------------ social recovery

    function startRecovery(address newOwner) external {
        if (msg.sender != guardian) revert NotAuthorized(msg.sender);
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        recoveryReadyAt = block.timestamp + RECOVERY_DELAY;
        emit RecoveryStarted(newOwner, recoveryReadyAt);
    }

    /// @notice The real owner sees the RecoveryStarted event and cancels a recovery they did not ask for.
    function cancelRecovery() external {
        if (msg.sender != owner && msg.sender != address(this)) revert NotAuthorized(msg.sender);
        if (pendingOwner == address(0)) revert NoRecoveryPending();
        emit RecoveryCancelled(pendingOwner);
        pendingOwner = address(0);
        recoveryReadyAt = 0;
    }

    /// @notice After the delay anyone can finish the recovery (the new owner usually does).
    function finishRecovery() external {
        address newOwner = pendingOwner;
        if (newOwner == address(0)) revert NoRecoveryPending();
        if (block.timestamp < recoveryReadyAt) revert RecoveryNotReady(recoveryReadyAt);
        emit OwnerChanged(owner, newOwner);
        owner = newOwner;
        pendingOwner = address(0);
        recoveryReadyAt = 0;
    }

    // ------------------------------------------------------------------ ERC-4337 hooks

    /// @inheritdoc BaseAccount
    /// @dev Same as BaseAccount, plus the gas-cost cap (QA M1) checked before any ETH is sent.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external override returns (uint256 validationData) {
        _requireFromEntryPoint();
        uint256 cost = maxGasCost(userOp);
        if (cost > MAX_GAS_COST_PER_OP) revert GasCostTooHigh(cost, MAX_GAS_COST_PER_OP);
        validationData = _validateSignature(userOp, userOpHash);
        _payPrefund(missingAccountFunds);
    }

    /// @notice The most this op can cost the wallet (the EntryPoint's "required prefund").
    ///         With a paymaster, the paymaster pays, so the wallet's cost is 0.
    function maxGasCost(PackedUserOperation calldata userOp) public pure returns (uint256) {
        if (userOp.paymasterAndData.length != 0) return 0;
        uint256 gas = userOp.unpackVerificationGasLimit() + userOp.unpackCallGasLimit() + userOp.preVerificationGas;
        return gas * userOp.unpackMaxFeePerGas();
    }

    /// @dev Called by BaseAccount.validateUserOp. Must not revert on a bad signature: return
    ///      SIG_VALIDATION_FAILED so bundlers can estimate gas and the EntryPoint reports "AA24".
    ///      Validation may only touch this wallet's own storage and must not read block.timestamp.
    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal view override returns (uint256) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, userOp.signature);
        if (err != ECDSA.RecoverError.NoError || signer != owner) return SIG_VALIDATION_FAILED;
        return SIG_VALIDATION_SUCCESS;
    }

    // ------------------------------------------------------------------ internals

    function _spend(uint256 value) internal {
        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) {
            currentDay = today;
            spentToday = 0;
        }
        uint256 left = dailyLimit > spentToday ? dailyLimit - spentToday : 0;
        if (value > left) revert DailyLimitExceeded(value, left);
        spentToday += value;
    }
}
