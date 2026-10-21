// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IReceiverHook} from "./IReceiverHook.sol";

interface ITokenVault {
    function deposit(IERC20 token, uint256 amount) external returns (uint256);

    function withdraw(IERC20 token, uint256 amount) external;

    function depositWithPermit(IERC20 token, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external
        returns (uint256);

    function balances(IERC20 token, address account) external view returns (uint256);

    function totalDeposits(IERC20 token) external view returns (uint256);
}

/// @title HookAttacker
/// @notice TEST ONLY. Deposits a hook token, withdraws it, and from the receive hook (a) tries to
/// call back into the vault (reentrancy: `withdraw`, `deposit` or `depositWithPermit`, chosen by
/// `mode`) and (b) just LOOKS at the vault's numbers (read-only reentrancy).
contract HookAttacker is IReceiverHook {
    ITokenVault public immutable vault;
    IERC20 public immutable token;
    uint256 public stake;
    uint8 public mode; // 0 = re-enter withdraw, 1 = re-enter deposit, 2 = re-enter depositWithPermit
    bool public reentered;
    bool public lastReentryFailed;
    bytes4 public lastRevertSelector;
    uint256 public seenBalance; // vault.balances(token, this) as seen DURING the callback
    uint256 public seenTotal; // vault.totalDeposits(token) as seen DURING the callback
    bool private _inCallback;

    constructor(address vault_, address token_) {
        vault = ITokenVault(vault_);
        token = IERC20(token_);
    }

    function attack(uint256 amount) external {
        _attack(0, amount);
    }

    function attackVia(uint8 mode_, uint256 amount) external {
        _attack(mode_, amount);
    }

    function _attack(uint8 mode_, uint256 amount) private {
        mode = mode_;
        stake = amount;
        token.approve(address(vault), amount);
        vault.deposit(token, amount);
        vault.withdraw(token, amount);
    }

    function onTokenReceived(address, uint256) external {
        if (_inCallback || msg.sender != address(token)) return;
        _inCallback = true;
        seenBalance = vault.balances(token, address(this));
        seenTotal = vault.totalDeposits(token);
        reentered = true;
        if (mode == 0) {
            try vault.withdraw(token, stake) {} catch (bytes memory reason) {
                _record(reason);
            }
        } else if (mode == 1) {
            try vault.deposit(token, 1) returns (uint256) {} catch (bytes memory reason) {
                _record(reason);
            }
        } else {
            try vault.depositWithPermit(token, 1, 0, 0, bytes32(0), bytes32(0)) returns (uint256) {} catch (
                bytes memory reason
            ) {
                _record(reason);
            }
        }
        _inCallback = false;
    }

    function _record(bytes memory reason) private {
        lastReentryFailed = true;
        if (reason.length >= 4) lastRevertSelector = bytes4(reason);
    }
}
