// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AggregatorV3Interface} from "./AggregatorV3Interface.sol";

/// @title MockV3Aggregator — a local stand-in for a Chainlink price feed
/// @notice On a real network many independent node operators report a price and the feed
///         publishes the median. Here one "reporter" (the deployer) plays all of them, so we
///         can make the feed go stale, report zero, or jump, and watch how consumers react.
///         Also used as an L2 *sequencer uptime* feed: answer 0 = sequencer up, 1 = down,
///         startedAt = when that status began.
contract MockV3Aggregator is AggregatorV3Interface {
    error NotReporter();

    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    address public immutable reporter;
    uint8 public immutable override decimals;
    string public override description;

    uint80 public latestRound;
    mapping(uint80 => Round) public rounds;

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        reporter = msg.sender;
        decimals = decimals_;
        description = description_;
        _push(initialAnswer, block.timestamp, block.timestamp);
    }

    modifier onlyReporter() {
        if (msg.sender != reporter) revert NotReporter();
        _;
    }

    /// @notice Normal update: a new round with the current time.
    function updateAnswer(int256 answer) external onlyReporter {
        _push(answer, block.timestamp, block.timestamp);
    }

    /// @notice Test hook: a new round with chosen timestamps (e.g. a "future" updatedAt).
    function updateRoundData(int256 answer, uint256 startedAt, uint256 updatedAt) external onlyReporter {
        _push(answer, startedAt, updatedAt);
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latestRound];
        return (latestRound, r.answer, r.startedAt, r.updatedAt, latestRound);
    }

    function _push(int256 answer, uint256 startedAt, uint256 updatedAt) private {
        uint80 id = latestRound + 1;
        latestRound = id;
        rounds[id] = Round(answer, startedAt, updatedAt);
    }
}
