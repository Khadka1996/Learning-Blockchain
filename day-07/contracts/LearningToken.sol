// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title LearningToken (LEARN)
/// @notice The "real" way: audited OpenZeppelin building blocks, a few lines of our own.
/// - `ERC20`          balances, allowances, transfer, approve, transferFrom
/// - `ERC20Burnable`  holders can burn their own tokens (or burn from an allowance)
/// - `ERC20Capped`    total supply can never exceed `cap()`
/// - `ERC20Permit`    EIP-2612: approve with a signed message instead of a transaction
/// - `Ownable`        only the owner may mint
/// @dev Educational token, not for real funds.
contract LearningToken is ERC20, ERC20Burnable, ERC20Capped, ERC20Permit, Ownable {
    constructor(address initialOwner, uint256 initialSupply, uint256 supplyCap)
        ERC20("Learning Token", "LEARN")
        ERC20Capped(supplyCap)
        ERC20Permit("Learning Token")
        Ownable(initialOwner)
    {
        _mint(initialOwner, initialSupply);
    }

    /// @notice Create new tokens (owner only). Reverts with ERC20ExceededCap past the cap.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // Solidity needs this because two parents (ERC20 and ERC20Capped) both define _update.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
