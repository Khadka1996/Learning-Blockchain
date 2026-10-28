pragma circom 2.1.6;

// "I know a secret number whose Poseidon hash is `hash`, and the prize goes to `recipient`."
// The secret stays private; only `hash` and `recipient` are public.
include "../node_modules/circomlib/circuits/poseidon.circom";

template ProveSecret() {
    signal input secret;      // PRIVATE: never leaves the prover's computer
    signal input hash;        // public: the lock everybody can see on-chain
    signal input recipient;   // public: who gets paid (binds the proof to one address)

    // Constraint 1: Poseidon(secret) must equal the public hash.
    component h = Poseidon(1);
    h.inputs[0] <== secret;
    hash === h.out;

    // Constraint 2: put `recipient` inside a real constraint. Without one, an optimiser may
    // drop the unused input and a proof could be re-used with ANY recipient (front-running).
    signal recipientSquare;
    recipientSquare <== recipient * recipient;
}

// Public signals (in this order): [hash, recipient]
component main {public [hash, recipient]} = ProveSecret();
