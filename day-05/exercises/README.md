# Day 05 — Exercises

Try each exercise before opening the suggested solution. The exercises use the
mini-EVM and storage helpers from `src/`.

```bash
npm run ex:easy
npm run ex:medium
npm run ex:challenge
```

## 1. Easy — Read a packed storage slot

Use `unpack(word, offset, size)` to read the `small` and `big` values from
slot 1 in `Layout.sol`. Explain why the low-order field is at offset `0` and
the high-order field starts at offset `16`.

**Expected result:** `small = 7`, `big = 9`.

## 2. Medium — Compare cold and warm storage

Assemble a program that writes a value to slot `0`, reads it twice, and
returns it. Inspect the trace and explain why the first storage access is
expensive while the second read is warm.

Then clear the slot and explain how the EVM refund is capped.

## 3. Challenge — Differentially test a new opcode

Add one supported opcode to the mini-EVM, such as `MUL` or `AND`. Write a
focused unit test for stack behavior, gas, and 256-bit wrapping, then add a
small Hardhat differential test proving the real EVM and mini-EVM agree.

### Review prompts

- Why must a storage map use `bigint` keys instead of JavaScript `number` keys?
- Why does a raw EVM interpreter need a gas limit even for code that looks
  finite?
- Why should runtime bytecode beginning with `0xEF` be rejected before
  deployment?
