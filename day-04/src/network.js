// Day 04 — a tiny peer-to-peer network simulator.
// Messages take time to travel (latency). That delay is what causes forks: two miners can find
// a block before hearing about each other's. Deterministic: same seed → same run.
"use strict";

const { Node } = require("./node");

/** Small seeded random number generator (mulberry32): returns numbers in [0, 1). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Network {
  #queue = []; // events sorted by time; equal times keep insertion order
  #seq = 0;

  /**
   * @param {object} params    from makeParams()
   * @param {string[]} ids     node names
   * @param {(from: string, to: string) => number} latency  ms for a message from → to
   */
  constructor(params, ids, latency) {
    this.now = 0;
    this.latency = latency;
    this.log = [];
    this.nodes = new Map(ids.map((id) => [id, new Node(id, params, { clock: () => this.now })]));
  }

  node(id) {
    return this.nodes.get(id);
  }

  #schedule(time, fn) {
    const ev = { time, seq: this.#seq++, fn };
    let i = this.#queue.length;
    while (i > 0 && this.#queue[i - 1].time > time) i--;
    this.#queue.splice(i, 0, ev);
  }

  /** At `time`, node `id` mines a block with `txs` on whatever its tip is then, and tells its peers. */
  mineAt(time, id, txs = [], onMined = () => {}) {
    this.#schedule(time, () => {
      const n = this.node(id);
      const block = n.mine(txs, this.now);
      this.log.push({ t: this.now, node: id, event: "mined", hash: block.hash, height: block.header.height });
      onMined(block);
      this.#gossip(id, block, null);
    });
  }

  /** Send a block to every peer except `except`. */
  #gossip(from, block, except) {
    for (const to of this.nodes.keys()) {
      if (to === from || to === except) continue;
      this.#schedule(this.now + this.latency(from, to), () => this.#deliver(to, from, block));
    }
  }

  #deliver(to, from, block) {
    const n = this.node(to);
    const r = n.receive(block);
    if (r.status === "added") {
      if (r.reorg && r.reorg.depth > 0) this.log.push({ t: this.now, node: to, event: "reorg", depth: r.reorg.depth, height: n.tip.height });
      for (const h of r.added) this.#gossip(to, n.getBlock(h), from); // pass on blocks that were new to us
    } else if (r.status === "orphan") {
      // We are missing the parent: ask the peer who sent this block for it.
      this.#schedule(this.now + this.latency(to, from), () => {
        const parent = this.node(from).getBlock(r.missing);
        if (parent) this.#schedule(this.now + this.latency(from, to), () => this.#deliver(to, from, parent));
      });
    } else if (r.status === "rejected") {
      this.log.push({ t: this.now, node: to, event: "rejected", reason: r.reason });
    }
  }

  /** Process events until the queue is empty or `until` (ms) is reached. */
  run(until = Infinity) {
    while (this.#queue.length && this.#queue[0].time <= until) {
      const ev = this.#queue.shift();
      this.now = ev.time;
      ev.fn();
    }
  }

  /** True when every node follows the same tip. */
  agreed() {
    const tips = new Set([...this.nodes.values()].map((n) => n.tip.hash));
    return tips.size === 1;
  }
}

/**
 * Random run: `blocks` blocks, each found by a random node, on average every `blockTime` ms;
 * every message takes `latency` ms ± 50 %. Returns fork statistics.
 */
function simulate({ params, nodes = 5, blocks = 200, blockTime = 1000, latency = 100, seed = 1 }) {
  const rand = rng(seed);
  const ids = Array.from({ length: nodes }, (_, i) => String.fromCharCode(65 + i));
  const net = new Network(params, ids, () => Math.round(latency * (0.5 + rand())));
  let t = 0;
  for (let i = 0; i < blocks; i++) {
    t += Math.max(1, Math.round(-Math.log(1 - rand()) * blockTime)); // exponential gaps, like real mining
    net.mineAt(t, ids[Math.floor(rand() * nodes)]);
  }
  net.run();
  // Equal-work branches can still be tied when mining stops (QA F1: 70 of 199 slow runs ended
  // split). In real networks a tie lasts until the next block, so mine one more after the
  // network is quiet: it has strictly more work than anything, and every node follows it.
  const splitAtEnd = !net.agreed();
  if (splitAtEnd) {
    net.mineAt(net.now + blockTime, ids[0]);
    net.run();
  }
  const mined = blocks + (splitAtEnd ? 1 : 0);
  const best = net.node(ids[0]);
  const stale = mined - best.tip.height; // blocks mined but not in the final chain
  const reorgs = net.log.filter((e) => e.event === "reorg");
  return {
    blocks: mined,
    splitAtEnd,
    finalHeight: best.tip.height,
    stale,
    staleRate: stale / blocks,
    reorgs: reorgs.length,
    deepestReorg: reorgs.reduce((m, e) => Math.max(m, e.depth), 0),
    agreed: net.agreed(),
    net,
  };
}

module.exports = { Network, simulate, rng };
