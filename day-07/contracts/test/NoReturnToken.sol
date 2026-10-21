// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title NoReturnToken
/// @notice TEST ONLY. Behaves like USDT on Ethereum mainnet: `transfer`, `transferFrom` and
/// `approve` return NOTHING (the ERC-20 standard says they return a bool). Calling it through a
/// plain `IERC20` interface makes Solidity revert while decoding the empty answer; `SafeERC20`
/// exists to handle exactly this.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    constructor(uint256 initialSupply) {
        balanceOf[msg.sender] = initialSupply;
        totalSupply = initialSupply;
    }

    function transfer(address to, uint256 value) external {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
    }

    function approve(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
    }

    function transferFrom(address from, address to, uint256 value) external {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}
