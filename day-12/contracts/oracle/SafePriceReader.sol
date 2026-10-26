// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

/// @title SafePriceReader — reads a Chainlink-style feed and refuses bad answers
/// @notice A price that is wrong is worse than no price: a lending protocol that values
///         collateral with a stale or broken price lets people borrow money they should not
///         get, or liquidates people who are fine. So every read goes through six checks and
///         reverts (fail closed) instead of guessing.
///
///   1. L2 sequencer up?          (only on L2s: feeds freeze while the sequencer is down)
///   2. grace period passed?      (after a restart, give users time to fix their positions)
///   3. answer > 0                (0 or negative = broken feed)
///   4. 0 < updatedAt <= now      (missing or "future" timestamp = broken feed)
///   5. age <= heartbeat          (the feed promises an update at least every heartbeat)
///   6. min <= answer <= max      (circuit breaker: a sane band set at deployment)
contract SafePriceReader {
    error SequencerDown();
    error GracePeriodNotOver(uint256 secondsLeft);
    error InvalidPrice(int256 answer);
    error InvalidTimestamp(uint256 updatedAt);
    error StalePrice(uint256 age, uint256 heartbeat);
    error PriceOutOfBounds(int256 answer);
    error BadConfig();

    AggregatorV3Interface public immutable feed;
    AggregatorV3Interface public immutable sequencerFeed; // address(0) on L1
    uint256 public immutable heartbeat; // seconds
    uint256 public immutable gracePeriod; // seconds
    int256 public immutable minAnswer;
    int256 public immutable maxAnswer;
    uint256 private immutable scale; // multiplies the raw answer up to 18 decimals

    constructor(
        AggregatorV3Interface feed_,
        AggregatorV3Interface sequencerFeed_,
        uint256 heartbeat_,
        uint256 gracePeriod_,
        int256 minAnswer_,
        int256 maxAnswer_
    ) {
        // Zero-address check FIRST: calling decimals() on address(0) would revert with no reason.
        if (address(feed_) == address(0) || heartbeat_ == 0 || minAnswer_ <= 0 || maxAnswer_ < minAnswer_) {
            revert BadConfig();
        }
        uint8 d = feed_.decimals();
        if (d > 18) revert BadConfig();
        feed = feed_;
        sequencerFeed = sequencerFeed_;
        heartbeat = heartbeat_;
        gracePeriod = gracePeriod_;
        minAnswer = minAnswer_;
        maxAnswer = maxAnswer_;
        scale = 10 ** (18 - d);
    }

    /// @return USD per 1 ETH with 18 decimals; reverts if the feed cannot be trusted right now
    function price() public view returns (uint256) {
        _checkSequencer();

        (, int256 answer, , uint256 updatedAt, ) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt == 0 || updatedAt > block.timestamp) revert InvalidTimestamp(updatedAt);
        uint256 age = block.timestamp - updatedAt;
        if (age > heartbeat) revert StalePrice(age, heartbeat);
        if (answer < minAnswer || answer > maxAnswer) revert PriceOutOfBounds(answer);

        return uint256(answer) * scale;
    }

    /// @return USD value (18 decimals) of `ethAmount` wei
    function usdValue(uint256 ethAmount) external view returns (uint256) {
        return (ethAmount * price()) / 1e18;
    }

    function _checkSequencer() private view {
        if (address(sequencerFeed) == address(0)) return; // L1: nothing to check
        (, int256 status, uint256 startedAt, , ) = sequencerFeed.latestRoundData();
        if (status != 0) revert SequencerDown();
        if (startedAt == 0 || startedAt > block.timestamp) revert InvalidTimestamp(startedAt);
        uint256 upFor = block.timestamp - startedAt;
        if (upFor <= gracePeriod) revert GracePeriodNotOver(gracePeriod - upFor);
    }
}
