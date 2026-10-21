// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IReceiverHook} from "./IReceiverHook.sol";

/// @title HookToken
/// @notice TEST ONLY. Like ERC-777: after a transfer to a CONTRACT, the token calls the receiver's
/// `onTokenReceived`. That hands control to the receiver in the middle of the sender's function,
/// which is exactly how reentrancy reaches code that "only moves tokens".
contract HookToken is ERC20 {
    constructor(uint256 initialSupply) ERC20("Hook Token", "HOOK") {
        _mint(msg.sender, initialSupply);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (to.code.length > 0 && from != address(0)) {
            // Optional, like ERC-777: a receiver that has no hook (the vault itself) is simply skipped.
            try IReceiverHook(to).onTokenReceived(address(this), value) {} catch {}
        }
    }
}
