# Day 15 — Evening exercises

Do them in order. Solutions are in [`solutions/`](solutions) and checked by `test/07-exercises.test.js` (`npm run ex`).

## 1. Easy — how different is the fingerprint after one letter?
**Goal:** write `bitsChanged(certA, certB)` that returns how many of the 256 bits of the two fingerprints differ. Change one letter in a recipient's name and print the result. Then show that writing the same certificate with its keys in a different order gives **0** changed bits.
**Hint:** `Certificate.hash()` returns a hex string. Turn it into a `BigInt`, XOR the two numbers (`^`) and count the 1-bits. About half (≈128) should flip: that is the "fingerprint" idea from Day 1, now used by a real app.
Solution: [`solutions/ex1-bits-changed.js`](solutions/ex1-bits-changed.js) · run `npm run ex1`

## 2. Medium — show the school's name, not just an address
**Goal:** the registry proves "address X issued this", not "X is Kathmandu University" (known issue K3). Write `describeVerdict(result, directory)` that takes a result from `verifyDocument` and a vetted `directory` (`{ "0xabc…": "Kathmandu University" }`) and returns one plain sentence for the page. Rules: a `VALID` certificate from an issuer that is **not** in the directory must say *"genuine, but the issuer is not on the vetted list"*; compare addresses case-insensitively.
**Hint:** look at `result.cert.issuer` and `result.verdict`. Never put the file's own text in the sentence without keeping it as plain text (the page uses `textContent`).
Solution: [`solutions/ex2-describe.js`](solutions/ex2-describe.js) · run `npm run ex2`

## 3. Challenge — check a whole folder of certificates at once
**Goal:** write `checkMany(registry, files, where)` that verifies many certificate files and returns `{ counts: { VALID: n, … }, duplicateIds: [...] }`. A `duplicateIds` entry means two **different** files from the same issuer use the same certificate `id`: not an error on-chain, but a red flag a human should look at.
**Hint:** call `verifyDocument` for each file (it never throws on bad files). Parse each file that is not `BAD_FILE` with `Certificate.parse` to read `issuer` and `id`, and group by `issuer + id` with a `Map`.
Solution: [`solutions/ex3-check-many.js`](solutions/ex3-check-many.js) · run `npm run ex3`
