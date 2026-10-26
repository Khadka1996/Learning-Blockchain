// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The read interface of a Chainlink-style price feed (same function names and
///         return values as Chainlink's AggregatorV3Interface), so the readers below would
///         work unchanged against a real feed.
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
