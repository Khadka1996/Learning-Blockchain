// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title SimplePair — a constant-product AMM (x · y = k) for two ERC-20 tokens
/// @author Manish Khadka (Day 10 of Learning Blockchain)
/// @notice Learning version of the Uniswap V2 idea, written from scratch:
///         - anyone can add both tokens and receive LP shares (this contract IS the LP token);
///         - anyone can swap one token for the other at a price set by the pool's balances;
///         - every swap pays a 0.30% fee that stays in the pool, so LP shares grow in value.
/// @dev Not audited, local-chain teaching code. Deliberate design choices:
///      * reserves are tracked internally (not read from balanceOf), so tokens "donated" to the
///        pool cannot move the price or inflate the share price (first-depositor attack);
///      * amounts actually received are measured (balance before/after), so fee-on-transfer
///        tokens cannot make the pool count tokens it never got;
///      * 1,000 shares are locked forever on the first deposit (MINIMUM_LIQUIDITY);
///      * every user-facing function takes a slippage limit and a deadline;
///      * reentrancy lock on every state-changing function.
contract SimplePair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Swap fee in basis points (30 / 10,000 = 0.30%).
    uint256 public constant FEE_BPS = 30;
    uint256 private constant BPS = 10_000;
    /// @notice Shares burned on the first deposit so the share price can never be pushed to absurd values.
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public immutable token0;
    IERC20 public immutable token1;

    /// @notice What the pool believes it holds. Only changed by addLiquidity / removeLiquidity / swap.
    uint256 public reserve0;
    uint256 public reserve1;

    error ZeroAddress();
    error IdenticalTokens();
    error InvalidToken(address token);
    error InvalidRecipient(address to);
    error ZeroAmount();
    error Expired(uint256 deadline, uint256 nowTs);
    error InsufficientLiquidity();
    error InsufficientLiquidityMinted(uint256 shares, uint256 minShares);
    error InsufficientAmounts(uint256 amount0, uint256 amount1);
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);

    event LiquidityAdded(address indexed provider, address indexed to, uint256 amount0, uint256 amount1, uint256 shares);
    event LiquidityRemoved(address indexed provider, address indexed to, uint256 amount0, uint256 amount1, uint256 shares);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut, address indexed to);
    event Sync(uint256 reserve0, uint256 reserve1);

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired(deadline, block.timestamp);
        _;
    }

    constructor(IERC20 tokenA, IERC20 tokenB) ERC20("SimplePair LP", "SPLP") {
        if (address(tokenA) == address(0) || address(tokenB) == address(0)) revert ZeroAddress();
        if (address(tokenA) == address(tokenB)) revert IdenticalTokens();
        // Sort like Uniswap so (A,B) and (B,A) describe the same pool.
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    // ───────────────────────────── views ─────────────────────────────

    /// @notice How many output tokens `amountIn` buys, after the 0.30% fee.
    /// @dev Derived from (x + Δx·0.997) · (y − Δy) = x · y  →  Δy = Δx·0.997·y / (x + Δx·0.997).
    ///      Rounds DOWN, so rounding always favours the pool, never the trader.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public pure returns (uint256) {
        if (amountIn == 0) revert ZeroAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * (BPS - FEE_BPS);
        return (amountInWithFee * reserveOut) / (reserveIn * BPS + amountInWithFee);
    }

    /// @notice Convenience quote for a swap of `amountIn` of `tokenIn` at the current reserves.
    function quote(address tokenIn, uint256 amountIn) external view returns (uint256) {
        (uint256 rIn, uint256 rOut) = _reservesFor(tokenIn);
        return getAmountOut(amountIn, rIn, rOut);
    }

    // ─────────────────────────── liquidity ───────────────────────────

    /// @notice Deposit both tokens and receive LP shares.
    /// @dev After the first deposit only the amounts matching the current ratio are taken;
    ///      the rest stays in the caller's wallet (nothing is wasted).
    /// @param minShares slippage limit: revert if fewer shares would be minted.
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 minShares,
        address to,
        uint256 deadline
    ) external nonReentrant beforeDeadline(deadline) returns (uint256 shares, uint256 amount0, uint256 amount1) {
        _checkRecipient(to); // QA L1: shares minted to the pool or a token contract are lost forever
        uint256 r0 = reserve0;
        uint256 r1 = reserve1;
        uint256 supply = totalSupply();

        (amount0, amount1) = supply == 0 ? (amount0Desired, amount1Desired) : _optimalAmounts(amount0Desired, amount1Desired, r0, r1);
        if (amount0 == 0 || amount1 == 0) revert ZeroAmount();

        // Count only what actually arrived (fee-on-transfer tokens deliver less than asked).
        amount0 = _pull(token0, amount0);
        amount1 = _pull(token1, amount1);

        if (supply == 0) {
            uint256 root = Math.sqrt(amount0 * amount1);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidityMinted(0, minShares);
            shares = root - MINIMUM_LIQUIDITY;
            _mint(DEAD, MINIMUM_LIQUIDITY); // locked forever
        } else {
            // Rounded down and the smaller side wins: the depositor can never get more than they paid for.
            shares = Math.min((amount0 * supply) / r0, (amount1 * supply) / r1);
        }
        if (shares == 0 || shares < minShares) revert InsufficientLiquidityMinted(shares, minShares);

        _mint(to, shares);
        _update(r0 + amount0, r1 + amount1);
        emit LiquidityAdded(msg.sender, to, amount0, amount1, shares);
    }

    /// @notice Burn LP shares and receive your part of both reserves.
    function removeLiquidity(
        uint256 shares,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external nonReentrant beforeDeadline(deadline) returns (uint256 amount0, uint256 amount1) {
        if (shares == 0) revert ZeroAmount();
        _checkRecipient(to);
        uint256 supply = totalSupply();
        uint256 r0 = reserve0;
        uint256 r1 = reserve1;

        amount0 = (shares * r0) / supply; // rounded down → dust stays with remaining LPs
        amount1 = (shares * r1) / supply;
        if (amount0 == 0 || amount1 == 0 || amount0 < amount0Min || amount1 < amount1Min) {
            revert InsufficientAmounts(amount0, amount1);
        }

        // Effects before interactions.
        _burn(msg.sender, shares);
        _update(r0 - amount0, r1 - amount1);

        token0.safeTransfer(to, amount0);
        token1.safeTransfer(to, amount1);
        emit LiquidityRemoved(msg.sender, to, amount0, amount1, shares);
    }

    // ───────────────────────────── swap ──────────────────────────────

    /// @notice Sell `amountIn` of `tokenIn` for the other token.
    /// @param minAmountOut slippage limit — the single most important protection against sandwich bots.
    function swap(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address to,
        uint256 deadline
    ) external nonReentrant beforeDeadline(deadline) returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();
        _checkRecipient(to);
        bool zeroForOne = tokenIn == address(token0);
        if (!zeroForOne && tokenIn != address(token1)) revert InvalidToken(tokenIn);
        (IERC20 tIn, IERC20 tOut) = zeroForOne ? (token0, token1) : (token1, token0);
        (uint256 rIn, uint256 rOut) = zeroForOne ? (reserve0, reserve1) : (reserve1, reserve0);

        uint256 received = _pull(tIn, amountIn);
        amountOut = getAmountOut(received, rIn, rOut);
        if (amountOut == 0 || amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);

        // amountOut < rOut always holds (the formula's denominator is larger than its numerator / rOut).
        if (zeroForOne) _update(rIn + received, rOut - amountOut);
        else _update(rOut - amountOut, rIn + received);

        tOut.safeTransfer(to, amountOut);
        emit Swap(msg.sender, address(tIn), received, amountOut, to);
    }

    // ─────────────────────────── internals ───────────────────────────

    function _optimalAmounts(uint256 d0, uint256 d1, uint256 r0, uint256 r1) private pure returns (uint256, uint256) {
        uint256 opt1 = (d0 * r1) / r0;
        if (opt1 <= d1) return (d0, opt1);
        return ((d1 * r0) / r1, d1);
    }

    /// @dev Pull `amount` from the caller and return how much really arrived.
    function _pull(IERC20 token, uint256 amount) private returns (uint256) {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        return token.balanceOf(address(this)) - before;
    }

    function _reservesFor(address tokenIn) private view returns (uint256, uint256) {
        if (tokenIn == address(token0)) return (reserve0, reserve1);
        if (tokenIn == address(token1)) return (reserve1, reserve0);
        revert InvalidToken(tokenIn);
    }

    /// @dev Sending tokens or shares to the zero address, the pool itself or a token contract would lose them forever.
    function _checkRecipient(address to) private view {
        if (to == address(0) || to == address(this) || to == address(token0) || to == address(token1)) {
            revert InvalidRecipient(to);
        }
    }

    function _update(uint256 r0, uint256 r1) private {
        reserve0 = r0;
        reserve1 = r1;
        emit Sync(r0, r1);
    }
}
