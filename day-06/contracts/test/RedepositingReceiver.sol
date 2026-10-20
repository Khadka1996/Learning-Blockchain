// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVault} from "../interfaces/IVault.sol";

/// @title RedepositingReceiver
/// @notice TEST ONLY. When a withdrawal pays it, it immediately deposits half of that
/// back from `receive()`. Legal (deposit is not guarded), but it exposes whether the
/// vault's events are emitted in an order an off-chain indexer can replay correctly.
contract RedepositingReceiver {
    IVault public immutable vault;
    bool private _done;

    constructor(address vault_) {
        vault = IVault(vault_);
    }

    function depositThenWithdraw() external payable {
        vault.deposit{value: msg.value}();
        vault.withdraw(msg.value);
    }

    receive() external payable {
        if (!_done) {
            _done = true;
            vault.deposit{value: msg.value / 2}();
        }
    }
}
