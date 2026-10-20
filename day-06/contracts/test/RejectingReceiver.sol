// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IVault} from "../interfaces/IVault.sol";

/// @title RejectingReceiver
/// @notice TEST ONLY. A contract with no receive() or fallback(), so any ETH sent to it
/// reverts. Used to prove that a failed payout reverts the whole withdrawal.
contract RejectingReceiver {
    function depositInto(IVault vault) external payable {
        vault.deposit{value: msg.value}();
    }

    function withdrawFrom(IVault vault, uint256 amount) external {
        vault.withdraw(amount);
    }
}
