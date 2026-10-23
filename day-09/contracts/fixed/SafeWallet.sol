// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SafeWallet — the fix for VulnerableWallet
/// @notice - The owner is set ONCE, in the constructor (there is no public initialize()).
///         - Owner-only functions use OpenZeppelin's `onlyOwner`.
///         - Handing over ownership is two-step (transferOwnership + acceptOwnership), so a typo
///           in the new owner's address cannot lock the wallet forever.
///         - renounceOwnership() is disabled, so the owner cannot lock the ETH by accident.
contract SafeWallet is Ownable2Step {
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error TransferFailed();
    error RenounceDisabled();

    constructor(address initialOwner) Ownable(initialOwner) {}

    receive() external payable {}

    /// @notice Disabled (QA M1). Ownable lets the owner give up ownership, but for a wallet that
    ///         would lock every ETH inside forever. One mistaken click must not do that.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    function withdrawAll(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        emit Withdrawn(to, amount);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
