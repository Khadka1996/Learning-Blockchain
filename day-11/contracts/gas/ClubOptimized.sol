// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ClubOptimized — the same members club, written to save gas
/// @author Manish Khadka (Day 11 of Learning Blockchain)
/// @notice Identical behaviour to ClubNaive (proved by differential tests).
///         Each saving is marked "SAVE:" with the trick it uses.
contract ClubOptimized {
    // SAVE 1 — storage packing: 20 + 8 + 4 bytes = 32 bytes = ONE slot instead of four.
    //   uint64 seconds lasts ~584 billion years; uint32 points caps a member at
    //   4,294,967,295 points, checked explicitly in addPointsBatch / join.
    struct Member {
        address referrer; // 20 bytes
        uint64 joinedAt; //  8 bytes (0 means "not a member")
        uint32 points; //  4 bytes
    }

    // SAVE 2 — immutable: the value is baked into the bytecode. Reading it costs
    //   ~3 gas instead of 2,100 for a cold storage read.
    address public immutable owner;
    uint256 public immutable joinFee;

    uint256 public totalPoints;
    uint256 public memberCount;
    mapping(address => Member) public members;

    // SAVE 3 — custom errors: a 4-byte selector instead of a stored string.
    error WrongFee(uint256 sent, uint256 required);
    error AlreadyMember();
    error SelfReferral();
    error NotMember(address who);
    error NotOwner();
    error ZeroAddress();
    error TransferFailed();
    error PointsOverflow(address who);

    event Joined(address indexed member, address indexed referrer);
    event PointsAdded(address indexed member, uint256 amount);

    constructor(uint256 fee) {
        owner = msg.sender;
        joinFee = fee;
    }

    function join(address referrer) external payable {
        if (msg.value != joinFee) revert WrongFee(msg.value, joinFee);
        if (members[msg.sender].joinedAt != 0) revert AlreadyMember();
        if (referrer == msg.sender) revert SelfReferral();

        if (referrer != address(0)) {
            // SAVE 4 — load the struct once into a storage pointer, update the packed slot once.
            Member storage r = members[referrer];
            if (r.joinedAt == 0) revert NotMember(referrer);
            uint256 newPoints = uint256(r.points) + 10;
            if (newPoints > type(uint32).max) revert PointsOverflow(referrer);
            r.points = uint32(newPoints);
            totalPoints += 10;
        }

        // block.timestamp fits in uint64 until the year 584,942,417,355.
        members[msg.sender] = Member({referrer: referrer, joinedAt: uint64(block.timestamp), points: 0});
        unchecked {
            ++memberCount; // cannot overflow: one member per address
        }
        emit Joined(msg.sender, referrer);
    }

    /// @notice Owner gives the same number of points to many members at once.
    /// SAVE 5 — `calldata`: read the list in place, no copy into memory.
    function addPointsBatch(address[] calldata list, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        uint256 len = list.length; // SAVE 6 — cache the length
        for (uint256 i; i < len; ) {
            address who = list[i];
            Member storage m = members[who];
            if (m.joinedAt == 0) revert NotMember(who);
            uint256 newPoints = uint256(m.points) + amount;
            if (newPoints > type(uint32).max) revert PointsOverflow(who);
            m.points = uint32(newPoints);
            emit PointsAdded(who, amount);
            // SAVE 7 — i < len, so ++i can never overflow
            unchecked {
                ++i;
            }
        }
        // SAVE 8 — one storage write for the whole batch (len * amount cannot overflow:
        //   every member already passed the uint32 check above, len is bounded by calldata).
        totalPoints += len * amount;
    }

    function pointsOf(address who) external view returns (uint256) {
        return members[who].points;
    }

    function withdraw(address payable to) external {
        if (msg.sender != owner) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }
}
