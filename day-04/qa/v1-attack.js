// Day 04 — the naive "tutorial" v1 I wrote first, and the attacks that broke it.
// Kept so the findings in QA.md can be reproduced: node qa/v1-attack.js
"use strict";
const { createHash } = require("crypto");
const H = (b) => createHash("sha256").update(b).digest();

// v1 Merkle tree: Bitcoin-style. No leaf/node tags; an odd last node is paired with itself.
function v1Root(leaves) {
  let level = leaves.map(H);
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H(Buffer.concat([level[i], level[i + 1]])));
    level = next;
  }
  return level[0];
}
function v1Proof(leaves, index) {
  let level = leaves.map(H); const path = [];
  while (level.length > 1) {
    if (level.length % 2) level.push(level[level.length - 1]);
    const sib = index ^ 1; path.push({ hash: level[sib], left: sib < index });
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H(Buffer.concat([level[i], level[i + 1]])));
    level = next; index >>= 1;
  }
  return path;
}
// v1 verify: hash the leaf, then fold the path. Nothing ties the proof to a position or tree size.
function v1Verify(leafData, path, root) {
  let h = H(leafData);
  for (const s of path) h = s.left ? H(Buffer.concat([s.hash, h])) : H(Buffer.concat([h, s.hash]));
  return h.equals(root);
}

const tx = (i) => Buffer.from(`tx-${i}`);
const out = [];

// A1: duplicate-last trick (CVE-2012-2459): [a,b,c] and [a,b,c,c] have the same root.
out.push(["A1 [a,b,c] and [a,b,c,c] share a root?", v1Root([tx(0), tx(1), tx(2)]).equals(v1Root([tx(0), tx(1), tx(2), tx(2)]))]);

// A2: second preimage: the 64 bytes of an inner node, presented as a "transaction", verify as a leaf.
{
  const leaves = [0, 1, 2, 3].map(tx); const root = v1Root(leaves);
  const fake = Buffer.concat([H(tx(0)), H(tx(1))]); // not a transaction in the block
  const path = v1Proof(leaves, 2).slice(1); path[0] = { hash: H(Buffer.concat([H(tx(2)), H(tx(3))])), left: false };
  out.push(["A2 64-byte inner node proven as a 'transaction'?", v1Verify(fake, path, root)]);
}

// v1 node: picks the LONGEST chain (most blocks), trusts the difficulty written in the block,
// keeps every orphan forever.
const v1Node = { chains: [[{ bits: 16 }, { bits: 16 }, { bits: 16 }]], orphans: [] };
const attackerChain = [{ bits: 16 }, { bits: 1 }, { bits: 1 }, { bits: 1 }, { bits: 1 }];
const work = (c) => c.reduce((s, b) => s + 2 ** b.bits, 0);
const longest = (cs) => cs.reduce((a, b) => (b.length > a.length ? b : a));
v1Node.chains.push(attackerChain);
out.push(["A3 attacker chain with ~8 guesses of work beats honest chain with ~131,000?",
  longest(v1Node.chains) === attackerChain && `attacker work ${work(attackerChain) - 2 ** 16}, honest ${work(v1Node.chains[0]) - 2 ** 16}`]);
for (let i = 0; i < 100000; i++) v1Node.orphans.push({ parent: "unknown-" + i });
out.push(["A4 100,000 junk orphans kept in memory?", v1Node.orphans.length]);

for (const [k, v] of out) console.log(k.padEnd(78), v);
