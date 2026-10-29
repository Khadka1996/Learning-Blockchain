"use strict";
// Exercise 2 — a plain sentence for the page, using a vetted list of issuer names.

/** @param {{verdict:string, cert?:{issuer:string}}} result  from verifyDocument
 *  @param {Record<string,string>} directory  vetted issuers: address -> name */
function describeVerdict(result, directory) {
  const names = new Map(Object.entries(directory).map(([addr, name]) => [addr.toLowerCase(), name]));
  const issuerName = result.cert ? names.get(result.cert.issuer.toLowerCase()) : undefined;
  switch (result.verdict) {
    case "VALID":
      return issuerName ? `Genuine certificate issued by ${issuerName}.` : "Genuine, but the issuer is not on the vetted list. Ask the school to confirm.";
    case "VALID_OLD_ISSUER":
      return `Genuine, but ${issuerName || "this issuer"} has since been removed from the registry. Check with them.`;
    case "REVOKED":
      return `Cancelled by ${issuerName || "its issuer"}. Do not accept it.`;
    case "NOT_FOUND":
      return "Not found. This certificate is fake or has been edited.";
    case "WRONG_REGISTRY":
      return "This file belongs to a different registry or chain.";
    default:
      return "This is not a well-formed certificate file.";
  }
}

module.exports = { describeVerdict };

if (require.main === module) {
  const dir = { "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266": "Kathmandu University" };
  const issuer = "0xf39fd6e51aad88f6f4ce6ab8827279cffFb92266".toLowerCase();
  console.log(describeVerdict({ verdict: "VALID", cert: { issuer } }, dir));
  console.log(describeVerdict({ verdict: "VALID", cert: { issuer: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" } }, dir));
  console.log(describeVerdict({ verdict: "NOT_FOUND" }, dir));
}
