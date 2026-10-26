// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title WrappedToken — the bridged IOU on the destination chain
/// @notice Only the bridge contract can mint. Its value rests 100% on the bridge being
///         honest: if the bridge mints without a matching lock, every holder is diluted.
contract WrappedToken is ERC20 {
    error NotBridge();

    address public immutable bridge;

    constructor(string memory name_, string memory symbol_, address bridge_) ERC20(name_, symbol_) {
        if (bridge_ == address(0)) revert NotBridge(); // a token nobody can ever mint
        bridge = bridge_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != bridge) revert NotBridge();
        _mint(to, amount);
    }
}
