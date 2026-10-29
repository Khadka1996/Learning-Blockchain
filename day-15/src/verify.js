"use strict";
/**
 * verifyDocument — the full check a verifier (an employer, a university) runs on a
 * certificate file. Shared by the Node demo, the tests and the web page.
 *
 * Checking the hash alone is NOT enough. The file must also be for THIS registry on
 * THIS chain (otherwise a forger deploys their own registry, makes themselves an
 * issuer and "issues" a matching hash there — QA finding M2), and the issuer named in
 * the file must be the one we look up.
 *
 * Verdicts (plain words for the page):
 *   VALID            genuine and not cancelled
 *   VALID_OLD_ISSUER genuine, but that issuer has since been removed — check with them
 *   REVOKED          was genuine, then cancelled
 *   NOT_FOUND        no such certificate: fake or edited
 *   WRONG_REGISTRY   the file belongs to another registry / chain
 *   BAD_FILE         the file is not a well-formed certificate
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./certificate"));
  else root.verifyDocument = factory(root.Certificate);
})(globalThis, function (Certificate) {
  const STATUS = ["Unknown", "Valid", "Revoked"];

  /**
   * @param {object} registry   an ethers Contract for CertificateRegistry (read-only is fine)
   * @param {string} fileText   the certificate file exactly as received (untrusted)
   * @param {{address:string, chainId:number|bigint}} expected  where we are checking
   */
  return async function verifyDocument(registry, fileText, expected) {
    let cert;
    try {
      cert = Certificate.parse(fileText);
    } catch (e) {
      return { verdict: "BAD_FILE", reason: e.message };
    }
    if (cert.registry.toLowerCase() !== String(expected.address).toLowerCase() || BigInt(cert.chainId) !== BigInt(expected.chainId)) {
      return { verdict: "WRONG_REGISTRY", reason: `file is for registry ${cert.registry} on chain ${cert.chainId}`, cert };
    }
    const certHash = Certificate.hash(cert);
    const r = await registry.verify(cert.issuer, certHash);
    const status = STATUS[Number(r.status)];
    const out = { cert, certHash, issuedAt: Number(r.issuedAt), revokedAt: Number(r.revokedAt), issuerActive: r.issuerActive };
    if (status === "Unknown") return { verdict: "NOT_FOUND", reason: "no certificate with this fingerprint from this issuer", ...out };
    if (status === "Revoked") return { verdict: "REVOKED", reason: "the issuer cancelled this certificate", ...out };
    if (!r.issuerActive) return { verdict: "VALID_OLD_ISSUER", reason: "genuine, but this issuer has since been removed", ...out };
    return { verdict: "VALID", reason: "genuine and not cancelled", ...out };
  };
});
