// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title StudyLog
/// @notice A tiny on-chain study diary. Its job is to show Solidity's building blocks
/// in one place: value types, `enum`, `struct`, arrays, mappings, data locations
/// (`storage` / `memory` / `calldata`), `view` vs `pure`, constants and immutables.
/// @dev Educational. Only the learner can write; anyone can read.
contract StudyLog {
    /// A named list of choices, stored as a `uint8` (0, 1, 2).
    enum Status {
        Planned,
        Learning,
        Done
    }

    /// Fields are ordered so `day`, `status` and `updatedAt` pack into ONE 32-byte slot
    /// after the string (uint8 + uint8 + uint64 = 10 bytes), see Day 05.
    struct Topic {
        string name;
        uint8 day;
        Status status;
        uint64 updatedAt;
    }

    uint256 public constant MAX_NAME_BYTES = 64; // constant: inlined, no storage
    uint8 public constant LAST_DAY = 15;

    address public immutable learner; // immutable: set once, lives in the bytecode

    Topic[] private _topics; // dynamic array of structs
    mapping(bytes32 nameHash => bool exists) private _used; // duplicate check

    error NotLearner(address caller);
    error EmptyName();
    error NameTooLong(uint256 length, uint256 maximum);
    error DayOutOfRange(uint8 day);
    error DuplicateTopic(string name);
    error UnknownTopic(uint256 id);

    event TopicAdded(uint256 indexed id, uint8 indexed day, string name);
    event StatusChanged(uint256 indexed id, Status from, Status to);

    modifier onlyLearner() {
        if (msg.sender != learner) revert NotLearner(msg.sender);
        _;
    }

    constructor() {
        learner = msg.sender;
    }

    /// @param name `calldata`: read-only, cheapest place for an external function's input.
    function addTopic(string calldata name, uint8 day) external onlyLearner returns (uint256 id) {
        uint256 length = bytes(name).length;
        if (length == 0) revert EmptyName();
        if (length > MAX_NAME_BYTES) revert NameTooLong(length, MAX_NAME_BYTES);
        if (day > LAST_DAY) revert DayOutOfRange(day);

        bytes32 key = keccak256(bytes(name));
        if (_used[key]) revert DuplicateTopic(name);
        _used[key] = true;

        id = _topics.length;
        _topics.push(Topic({name: name, day: day, status: Status.Planned, updatedAt: uint64(block.timestamp)}));
        emit TopicAdded(id, day, name);
    }

    function setStatus(uint256 id, Status next) external onlyLearner {
        if (id >= _topics.length) revert UnknownTopic(id);
        Topic storage topic = _topics[id]; // `storage` pointer: edits the real data
        Status previous = topic.status;
        topic.status = next;
        topic.updatedAt = uint64(block.timestamp);
        emit StatusChanged(id, previous, next);
    }

    function topicCount() external view returns (uint256) {
        return _topics.length;
    }

    /// @dev Returns a `memory` copy of the stored struct.
    function getTopic(uint256 id) external view returns (Topic memory) {
        if (id >= _topics.length) revert UnknownTopic(id);
        return _topics[id];
    }

    /// @dev A loop over storage is fine in a `view` call made off-chain, but a state-changing
    /// function must never loop over a list anyone can grow (denial of service).
    function countByStatus(Status wanted) external view returns (uint256 count) {
        uint256 total = _topics.length;
        for (uint256 i = 0; i < total; i++) {
            if (_topics[i].status == wanted) count++;
        }
    }

    /// @dev `pure`: reads nothing from the chain at all.
    function nameLength(string memory text) public pure returns (uint256) {
        return bytes(text).length;
    }
}
