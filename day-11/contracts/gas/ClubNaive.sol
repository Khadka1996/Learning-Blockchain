// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ClubNaive — a members club written the "obvious" way
/// @author Manish Khadka (Day 11 of Learning Blockchain)
/// @notice Works correctly, but wastes gas everywhere. ClubOptimized does exactly the
///         same job; the tests prove both behave identically and the gas report
///         measures the difference. TEACHING CODE: every waste is marked "GAS:".
/// @dev Solhint gas rules are switched off for this file on purpose.
/* solhint-disable gas-custom-errors, gas-struct-packing, gas-increment-by-one, gas-length-in-loops */
contract ClubNaive {
    // GAS: 4 storage slots per member. bool (1 byte) and address (20 bytes) each take a
    //      whole 32-byte slot because they sit next to full uint256 fields.
    struct Member {
        bool active;
        uint256 joinedAt;
        uint256 points;
        address referrer;
    }

    // GAS: never change after deployment, but live in storage (2,100 gas per first read).
    address public owner;
    uint256 public joinFee;

    uint256 public totalPoints;
    uint256 public memberCount;
    mapping(address => Member) public members;

    event Joined(address indexed member, address indexed referrer);
    event PointsAdded(address indexed member, uint256 amount);

    constructor(uint256 fee) {
        owner = msg.sender;
        joinFee = fee;
    }

    /// @notice Pay the fee and become a member. A referrer (an existing member) earns 10 points.
    function join(address referrer) external payable {
        // GAS: revert strings are stored in the bytecode and copied into memory on failure.
        require(msg.value == joinFee, "ClubNaive: wrong fee");
        require(!members[msg.sender].active, "ClubNaive: already a member");
        require(referrer != msg.sender, "ClubNaive: cannot refer yourself");

        members[msg.sender] = Member({active: true, joinedAt: block.timestamp, points: 0, referrer: referrer});
        memberCount = memberCount + 1;

        if (referrer != address(0)) {
            require(members[referrer].active, "ClubNaive: referrer not a member");
            members[referrer].points += 10;
            totalPoints += 10;
        }
        emit Joined(msg.sender, referrer);
    }

    /// @notice Owner gives the same number of points to many members at once.
    // GAS: `memory` copies the whole array from calldata first.
    function addPointsBatch(address[] memory list, uint256 amount) public {
        require(msg.sender == owner, "ClubNaive: not owner");
        // GAS: list.length re-read every loop; i++ is overflow-checked although it can't overflow.
        for (uint256 i = 0; i < list.length; i++) {
            require(members[list[i]].active, "ClubNaive: not a member");
            members[list[i]].points += amount;
            // GAS: writes the same storage slot once per member instead of once per call.
            totalPoints += amount;
            emit PointsAdded(list[i], amount);
        }
    }

    function pointsOf(address who) external view returns (uint256) {
        return members[who].points;
    }

    /// @notice Owner withdraws the collected fees.
    function withdraw(address payable to) external {
        require(msg.sender == owner, "ClubNaive: not owner");
        require(to != address(0), "ClubNaive: zero address");
        (bool ok, ) = to.call{value: address(this).balance}("");
        require(ok, "ClubNaive: transfer failed");
    }
}
