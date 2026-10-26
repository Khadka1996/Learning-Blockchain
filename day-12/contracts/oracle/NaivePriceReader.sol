// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

/// @title NaivePriceReader — DO NOT USE. The "before" picture.
/// @notice Reads the feed and trusts whatever comes back: an hours-old price, a zero, a
///         negative number (which casts to a gigantic uint), or a price while the L2
///         sequencer is down. Every one of those has cost real protocols real money.
contract NaivePriceReader {
    AggregatorV3Interface public immutable feed;

    constructor(AggregatorV3Interface feed_) {
        feed = feed_;
    }

    /// @return price USD per 1 ETH with 18 decimals (assumes an 8-decimal feed — another bug)
    function price() public view returns (uint256) {
        (, int256 answer, , , ) = feed.latestRoundData();
        return uint256(answer) * 1e10; // no checks at all
    }

    /// @return USD value (18 decimals) of `ethAmount` wei
    function usdValue(uint256 ethAmount) external view returns (uint256) {
        return (ethAmount * price()) / 1e18;
    }
}
