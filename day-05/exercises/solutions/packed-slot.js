const { unpack } = require("../../src/storage");

const word = (9n << 128n) | 7n;
console.log(`small = ${unpack(word, 0, 16)}`);
console.log(`big = ${unpack(word, 16, 16)}`);
