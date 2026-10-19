// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title Layout — a tiny contract whose only job is to show WHERE Solidity puts data.
/// @notice Every contract owns 2^256 storage "lockers" (slots) of 32 bytes each.
///         Solidity fills them in declaration order and packs small values together.
///         Day 05 reads these lockers directly with eth_getStorageAt and checks the rules.
contract Layout {
    // slot 0 — a full 32-byte number
    uint256 public counter;

    // slot 1 — two 16-byte numbers share ONE slot (packing): `small` sits in the
    //          low 16 bytes, `big` in the high 16 bytes.
    uint128 public small;
    uint128 public big;

    // slot 2 — a 20-byte address and a 1-byte bool packed together (21 of 32 bytes)
    address public owner;
    bool public paused;

    // slot 3 — the mapping itself stores nothing here. Value for `key` lives at
    //          keccak256(abi.encode(key, uint256(3))).
    mapping(address => uint256) public balances;

    // slot 4 — holds the array LENGTH. Element i lives at keccak256(uint256(4)) + i.
    uint256[] public items;

    event Deposited(address indexed from, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner(address caller);
    error Paused();
    error InsufficientBalance(uint256 requested, uint256 available);
    error TransferFailed();

    constructor() {
        owner = msg.sender;
        small = 7;
        big = 9;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @notice Add 1 to counter (used to measure the gas of writing an existing slot).
    function increment() external {
        counter += 1;
    }

    /// @notice Record a deposit for the sender. Payable so we can see ETH move into a contract.
    function deposit() external payable {
        if (paused) revert Paused();
        uint256 newBalance = balances[msg.sender] + msg.value;
        balances[msg.sender] = newBalance;
        emit Deposited(msg.sender, msg.value, newBalance);
    }

    /// @notice Take back your own deposit. Checks → effects → interaction order:
    ///         the balance is reduced BEFORE the ETH is sent, so a re-entering caller sees 0.
    function withdraw(uint256 amount) external {
        uint256 available = balances[msg.sender];
        if (amount > available) revert InsufficientBalance(amount, available);
        balances[msg.sender] = available - amount;
        emit Withdrawn(msg.sender, amount);
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function push(uint256 value) external onlyOwner {
        items.push(value);
    }

    function setPaused(bool value) external onlyOwner {
        paused = value;
    }

    function itemsLength() external view returns (uint256) {
        return items.length;
    }
}
