// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title PullAuction — worked solution to Medium exercise 4
/// @notice A 1-day auction. Outbid bidders are NOT paid on the spot (push); their money is recorded
///         and they collect it themselves (pull). The seller collects the winning bid after the end.
///         A bidder that refuses ETH can only block itself, never the auction.
contract PullAuction is ReentrancyGuard {
    address public immutable seller;
    uint256 public immutable endTime;
    address public highestBidder;
    uint256 public highestBid;
    bool public settled;
    mapping(address => uint256) public pendingReturns;

    event Bid(address indexed bidder, uint256 amount);
    event Withdrawn(address indexed who, uint256 amount);
    event Settled(address indexed winner, uint256 amount);

    error AuctionEnded();
    error AuctionNotEnded();
    error BidTooLow(uint256 current, uint256 offered);
    error NothingToWithdraw();
    error AlreadySettled();
    error NotSeller();
    error TransferFailed();

    constructor(uint256 duration) {
        seller = msg.sender;
        endTime = block.timestamp + duration;
    }

    function bid() external payable nonReentrant {
        if (block.timestamp >= endTime) revert AuctionEnded();
        if (msg.value <= highestBid) revert BidTooLow(highestBid, msg.value);
        if (highestBidder != address(0)) pendingReturns[highestBidder] += highestBid;
        highestBidder = msg.sender;
        highestBid = msg.value;
        emit Bid(msg.sender, msg.value);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingReturns[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function settle() external nonReentrant {
        if (msg.sender != seller) revert NotSeller();
        if (block.timestamp < endTime) revert AuctionNotEnded();
        if (settled) revert AlreadySettled();
        settled = true;
        uint256 amount = highestBid;
        emit Settled(highestBidder, amount);
        // solhint-disable-next-line avoid-low-level-calls
        (bool ok, ) = seller.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
