pragma circom 2.1.6;

// NAIVE version for the front-running demo: the proof says "someone knows the secret",
// but NOT who should be paid. Whoever copies the proof first can claim the prize.
include "../node_modules/circomlib/circuits/poseidon.circom";

template ProveSecretNaive() {
    signal input secret;   // PRIVATE
    signal input hash;     // public

    component h = Poseidon(1);
    h.inputs[0] <== secret;
    hash === h.out;
}

component main {public [hash]} = ProveSecretNaive();
