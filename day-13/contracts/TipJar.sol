// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title TipJar — the contract behind Day 13's full-stack dApp
/// @author Manish Khadka
/// @notice Anyone can send a small ETH tip with a short public message.
///         The owner (whoever deployed it) can withdraw the collected ETH.
/// @dev Deliberately small: the lesson today is the whole stack around it
///      (frontend, wallet, deploy script). It reuses ideas from earlier days:
///      custom errors (Day 06), events for the UI (Day 06), the
///      checks-effects-interactions order and a single-recipient withdrawal (Day 09),
///      and bounded loops (Day 09 DoS).
contract TipJar {
    /// @notice One tip as stored on-chain and shown in the frontend.
    struct Tip {
        address from;
        uint64 timestamp;
        uint256 amount;
        string message;
    }

    /// @notice Longest message accepted, in BYTES (UTF-8: an emoji is 4 bytes).
    uint256 public constant MAX_MESSAGE_BYTES = 140;
    /// @notice Smallest tip accepted (stops free spam that only costs gas).
    uint256 public constant MIN_TIP = 0.0001 ether;
    /// @notice Most tips returned by one `getTips` call (keeps RPC calls bounded).
    uint256 public constant MAX_PAGE = 50;

    /// @notice The account allowed to withdraw. Fixed at deploy time.
    address public immutable owner;

    /// @notice Sum of all tips ever received, in wei (does not go down on withdraw).
    uint256 public totalTipped;

    Tip[] private _tips;

    event TipSent(uint256 indexed id, address indexed from, uint256 amount, string message);
    event Withdrawn(address indexed to, uint256 amount);

    error TipTooSmall(uint256 sent, uint256 minimum);
    error EmptyMessage();
    error MessageTooLong(uint256 length, uint256 maximum);
    error NotOwner(address caller);
    error ZeroAddress();
    error NothingToWithdraw();
    error TransferFailed();
    error UseTipFunction();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Send a tip with a message. The ETH sent (`msg.value`) is the tip.
    /// @param message 1–140 bytes of text. Stored as-is: the frontend must treat it
    ///        as untrusted text (never as HTML) (XSS).
    function tip(string calldata message) external payable {
        if (msg.value < MIN_TIP) revert TipTooSmall(msg.value, MIN_TIP);
        uint256 len = bytes(message).length;
        if (len == 0) revert EmptyMessage();
        if (len > MAX_MESSAGE_BYTES) revert MessageTooLong(len, MAX_MESSAGE_BYTES);

        uint256 id = _tips.length;
        _tips.push(Tip({from: msg.sender, timestamp: uint64(block.timestamp), amount: msg.value, message: message}));
        totalTipped += msg.value;
        emit TipSent(id, msg.sender, msg.value, message);
    }

    /// @notice Owner sends the whole balance to `to`.
    /// @dev Checks-effects-interactions: nothing is written after the external call,
    ///      and the amount is the live balance, so a re-entrant call finds 0.
    function withdraw(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        if (amount == 0) revert NothingToWithdraw();
        emit Withdrawn(to, amount);
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Number of tips so far.
    function tipCount() external view returns (uint256) {
        return _tips.length;
    }

    /// @notice A page of tips, NEWEST first.
    /// @param offset how many of the newest tips to skip (0 = start at the newest)
    /// @param limit  how many to return (capped at MAX_PAGE)
    function getTips(uint256 offset, uint256 limit) external view returns (Tip[] memory page) {
        uint256 total = _tips.length;
        if (offset >= total || limit == 0) return new Tip[](0);
        if (limit > MAX_PAGE) limit = MAX_PAGE;
        uint256 available = total - offset;
        uint256 n = limit < available ? limit : available;
        page = new Tip[](n);
        for (uint256 i = 0; i < n; ++i) {
            page[i] = _tips[total - 1 - offset - i];
        }
    }

    /// @dev Plain ETH transfers are refused so every tip has a message and an event.
    receive() external payable {
        revert UseTipFunction();
    }
}
