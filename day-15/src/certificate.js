"use strict";
/**
 * Off-chain half of the certificate system: build a certificate, turn it into ONE
 * exact string (canonical JSON), and fingerprint it with keccak256.
 *
 * Why "canonical"? {"a":1,"b":2} and {"b":2,"a":1} mean the same thing but are
 * different bytes, so they would get different hashes. We fix ONE way of writing
 * every certificate: keys sorted, no spaces, Unicode normalised (NFC) so "é" typed
 * two different ways is the same text.
 *
 * Why a salt? Only the hash goes on-chain. Without a random salt, anyone who knows
 * a student's name and course could hash the guess and confirm it. 16 random bytes
 * (2^128 possibilities) make guessing hopeless.
 *
 * This file works in Node AND in the browser (the frontend loads it as a script).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("ethers"), require("node:crypto"));
  else root.Certificate = factory(root.ethers, root.crypto);
})(globalThis, function (ethers, cryptoLib) {
  const VERSION = 1;
  const FIELDS = ["version", "registry", "chainId", "issuer", "id", "recipient", "course", "issuedOn", "salt"];
  const MAX_TEXT = 120; // characters, for recipient / course / id

  function randomSalt() {
    const bytes = new Uint8Array(16);
    (cryptoLib.webcrypto || cryptoLib).getRandomValues(bytes);
    return ethers.hexlify(bytes);
  }

  function cleanText(name, value) {
    if (typeof value !== "string") throw new Error(`${name} must be text`);
    const v = value.normalize("NFC").trim();
    if (v.length === 0) throw new Error(`${name} is empty`);
    if (v.length > MAX_TEXT) throw new Error(`${name} is longer than ${MAX_TEXT} characters`);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) throw new Error(`${name} contains control characters`);
    return v;
  }

  /** Check every field and return a clean copy in a fixed shape. Throws on anything odd. */
  function validate(cert) {
    if (!cert || typeof cert !== "object" || Array.isArray(cert)) throw new Error("certificate must be an object");
    const extra = Object.keys(cert).filter((k) => !FIELDS.includes(k));
    if (extra.length) throw new Error(`unknown field(s): ${extra.join(", ")}`);
    if (cert.version !== VERSION) throw new Error(`version must be ${VERSION}`);
    if (!ethers.isAddress(cert.registry)) throw new Error("registry must be an address");
    if (!ethers.isAddress(cert.issuer)) throw new Error("issuer must be an address");
    if (!Number.isSafeInteger(cert.chainId) || cert.chainId <= 0) throw new Error("chainId must be a positive integer");
    if (typeof cert.issuedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(cert.issuedOn) || Number.isNaN(Date.parse(cert.issuedOn + "T00:00:00Z")) || new Date(cert.issuedOn + "T00:00:00Z").toISOString().slice(0, 10) !== cert.issuedOn)
      throw new Error("issuedOn must be a real date YYYY-MM-DD");
    if (typeof cert.salt !== "string" || !/^0x[0-9a-f]{32}$/.test(cert.salt)) throw new Error("salt must be 16 bytes of lower-case hex");
    return {
      version: VERSION,
      registry: ethers.getAddress(cert.registry),
      chainId: cert.chainId,
      issuer: ethers.getAddress(cert.issuer),
      id: cleanText("id", cert.id),
      recipient: cleanText("recipient", cert.recipient),
      course: cleanText("course", cert.course),
      issuedOn: cert.issuedOn,
      salt: cert.salt,
    };
  }

  /** Make a new certificate with a fresh random salt. */
  function create({ registry, chainId, issuer, id, recipient, course, issuedOn }) {
    return validate({ version: VERSION, registry, chainId: Number(chainId), issuer, id, recipient, course, issuedOn, salt: randomSalt() });
  }

  /** The ONE exact text for a certificate: validated, keys sorted, no whitespace. */
  function canonicalize(cert) {
    const c = validate(cert);
    const sorted = {};
    for (const k of Object.keys(c).sort()) sorted[k] = c[k];
    return JSON.stringify(sorted);
  }

  /** The certificate's fingerprint: keccak256 of its canonical text. This goes on-chain. */
  function hash(cert) {
    return ethers.keccak256(ethers.toUtf8Bytes(canonicalize(cert)));
  }

  /** Parse a certificate file the user pasted/uploaded (untrusted text). */
  function parse(text) {
    if (typeof text !== "string" || text.length > 10000) throw new Error("certificate file is missing or too large");
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error("not valid JSON");
    }
    return validate(obj);
  }

  return { VERSION, FIELDS, create, validate, canonicalize, hash, parse, randomSalt };
});
