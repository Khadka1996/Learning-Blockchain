// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title MiniToken
/// @notice A fungible token written from scratch to see every moving part of ERC-20:
/// a balance table, an allowance table, `transfer`, `approve`, `transferFrom`
/// and the two events apps listen to.
/// @dev Educational, NOT audited. It follows ERC-20 and uses the error names of ERC-6093
/// (the same ones OpenZeppelin 5 uses), so `test/differential.test.js` can run it against
/// OpenZeppelin side by side. Every state change goes through `_update`, like OpenZeppelin.
contract MiniToken {
    // Storage layout (read raw in test/storage.test.js):
    //   slot 0: name   slot 1: symbol   slot 2: totalSupply
    //   slot 3: balanceOf (mapping base)   slot 4: allowance (nested mapping base)
    string public name;
    string public symbol;
    uint256 public totalSupply;
    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    /// 18 decimals: 1 token = 10**18 base units. The chain only knows integers.
    /// Lowercase on purpose: `decimals()` is the name the ERC-20 standard defines.
    // solhint-disable-next-line const-name-snakecase
    uint8 public constant decimals = 18;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed);
    error ERC20InvalidSender(address sender);
    error ERC20InvalidReceiver(address receiver);
    error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error ERC20InvalidApprover(address approver);
    error ERC20InvalidSpender(address spender);

    constructor(string memory name_, string memory symbol_, uint256 initialSupply) {
        name = name_;
        symbol = symbol_;
        _update(address(0), msg.sender, initialSupply); // mint
    }

    function transfer(address to, uint256 value) external virtual returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external virtual returns (bool) {
        _approve(msg.sender, spender, value, true);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external virtual returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value);
        return true;
    }

    /// @notice Destroy some of the caller's own tokens.
    function burn(uint256 value) external virtual {
        _update(msg.sender, address(0), value);
    }

    function _transfer(address from, address to, uint256 value) internal {
        if (from == address(0)) revert ERC20InvalidSender(address(0));
        if (to == address(0)) revert ERC20InvalidReceiver(address(0));
        _update(from, to, value);
    }

    /// @dev The ONE place balances and totalSupply change.
    /// from == 0 means mint, to == 0 means burn; anything else is a plain move.
    function _update(address from, address to, uint256 value) internal virtual {
        if (from == address(0)) {
            totalSupply += value;
        } else {
            uint256 fromBalance = balanceOf[from];
            if (fromBalance < value) revert ERC20InsufficientBalance(from, fromBalance, value);
            unchecked {
                balanceOf[from] = fromBalance - value; // cannot underflow: checked just above
            }
        }

        if (to == address(0)) {
            unchecked {
                totalSupply -= value; // cannot underflow: value <= a balance <= totalSupply
            }
        } else {
            unchecked {
                balanceOf[to] += value; // cannot overflow: the sum of all balances is totalSupply
            }
        }

        emit Transfer(from, to, value);
    }

    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal virtual {
        if (owner == address(0)) revert ERC20InvalidApprover(address(0));
        if (spender == address(0)) revert ERC20InvalidSpender(address(0));
        allowance[owner][spender] = value;
        if (emitEvent) emit Approval(owner, spender, value);
    }

    /// @dev An allowance of type(uint256).max means "unlimited" and is never reduced
    /// (saves a storage write on every transferFrom; same convention as OpenZeppelin).
    function _spendAllowance(address owner, address spender, uint256 value) internal virtual {
        uint256 current = allowance[owner][spender];
        if (current != type(uint256).max) {
            if (current < value) revert ERC20InsufficientAllowance(spender, current, value);
            unchecked {
                _approve(owner, spender, current - value, false); // no event: Approval is for explicit approvals
            }
        }
    }
}
