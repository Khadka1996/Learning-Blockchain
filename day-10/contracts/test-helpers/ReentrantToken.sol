// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ISwap {
    function swap(address tokenIn, uint256 amountIn, uint256 minAmountOut, address to, uint256 deadline) external returns (uint256);
    function reserve0() external view returns (uint256);
    function reserve1() external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// @notice TEST ONLY: a hostile token that calls back into the pool while it is being transferred
///         (like an ERC-777 hook). Used to prove the pool's reentrancy lock holds.
contract ReentrantToken is ERC20 {
    ISwap public target;
    bool public armed;
    bool public spying;
    /// @notice What an outside contract would read from the pool in the middle of a swap.
    uint256 public seenReserve0;
    uint256 public seenReserve1;
    uint256 public seenSupply;

    constructor() ERC20("Hook Token", "HOOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(ISwap target_) external {
        target = target_;
        armed = true;
    }

    /// @notice Instead of re-entering, just READ the pool mid-transfer (read-only re-entrancy probe).
    function spy(ISwap target_) external {
        target = target_;
        spying = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (spying && from != address(0) && to == address(target)) {
            spying = false;
            seenReserve0 = target.reserve0();
            seenReserve1 = target.reserve1();
            seenSupply = target.totalSupply();
        }
        if (armed && from != address(0) && to == address(target)) {
            armed = false;
            // Try to swap again while the first swap is still running.
            target.swap(address(this), 1, 0, from, type(uint256).max);
        }
    }
}
