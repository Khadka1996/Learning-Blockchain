// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAuction {
    function bid() external payable;
}

/// @notice Test-only: a bidder that cannot receive ETH (no receive/fallback), so any push refund to it fails.
contract StubbornBidder {
    function bidOn(address auction) external payable {
        IAuction(auction).bid{value: msg.value}();
    }
}
