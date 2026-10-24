// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY: a token whose issuer can silently take balance from any holder (negative rebase).
contract RebasingToken is ERC20 {
    constructor() ERC20("Rebasing", "REB") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Burns `amount` from `holder` without their consent, like a negative-rebase or confiscating token.
    function confiscate(address holder, uint256 amount) external {
        _burn(holder, amount);
    }
}
