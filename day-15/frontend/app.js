/* CertCheck frontend — plain JavaScript + ethers v6 + any EIP-1193 wallet (MetaMask).
 *
 *   VERIFY (anyone, free):  file → canonical text → keccak256 → registry.verify()  (a read, no tx)
 *   ISSUE / REVOKE (issuers): the wallet signs a transaction; the page never sees a key.
 *
 * Security rules this file follows:
 *   - Certificate files are UNTRUSTED: parsed + validated by lib/certificate.js and only
 *     ever shown with textContent (never innerHTML).
 *   - The file must name the registry we trust, on the chain we check (lib/verify.js).
 *   - Never trust config blindly: there must be contract code at the address.
 */
(function () {
  "use strict";

  const ethers = window.ethers;
  const Certificate = window.Certificate;
  const verifyDocument = window.verifyDocument;
  const cfg = window.DAPP_CONFIG || { deployments: {}, abi: [] };
  const iface = new ethers.Interface(cfg.abi);
  const $ = (id) => document.getElementById(id);
  const state = { provider: null, chainId: null, account: null, signer: null, isIssuer: false, isAdmin: false, gen: 0, downloadUrl: null };

  const VERDICTS = {
    VALID: ["✅ Genuine certificate", "ok"],
    VALID_OLD_ISSUER: ["⚠️ Genuine, but the issuer was removed", "warn"],
    REVOKED: ["❌ Revoked by the issuer", "bad"],
    NOT_FOUND: ["❌ Not found: fake or edited", "bad"],
    WRONG_REGISTRY: ["❌ Wrong registry", "bad"],
    BAD_FILE: ["❌ Not a valid certificate file", "bad"],
  };
  const ERROR_TEXT = {
    AccessControlUnauthorizedAccount: () => "This account is not an issuer.",
    ZeroHash: () => "Empty fingerprint.",
    AlreadyIssued: () => "This exact certificate is already on the registry.",
    NotIssued: () => "This certificate was never issued here.",
    AlreadyRevoked: () => "This certificate is already revoked.",
    NotAllowedToRevoke: () => "Only its own active issuer or the admin can revoke this certificate.",
    ReasonTooLong: (a) => `Reason is ${a[0]} bytes; the limit is 200.`,
  };

  function setStatus(text, kind) {
    $("status").textContent = text;
    $("status").dataset.kind = kind || "info";
  }
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const when = (sec) => (sec ? new Date(sec * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");

  function friendlyError(e) {
    const code = e && (e.code ?? (e.info && e.info.error && e.info.error.code));
    if (code === 4001 || code === "ACTION_REJECTED") return "You cancelled the request in your wallet.";
    if (e && e.revert && ERROR_TEXT[e.revert.name]) return ERROR_TEXT[e.revert.name](e.revert.args);
    const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        const p = iface.parseError(data);
        if (p && ERROR_TEXT[p.name]) return ERROR_TEXT[p.name](p.args);
      } catch {
        /* not one of ours */
      }
    }
    return "Something went wrong: " + ((e && (e.shortMessage || e.message)) || String(e));
  }

  // ---------- reading the registry (no wallet needed on the local chain) ----------
  async function registryFor(chainId) {
    const dep = cfg.deployments[chainId];
    if (!dep) return { error: `This page has no registry on chain ${chainId}.` };
    let provider;
    if (state.provider && state.chainId === chainId) provider = state.provider;
    else if (dep.rpc) provider = new ethers.JsonRpcProvider(dep.rpc, chainId, { staticNetwork: true });
    else return { error: `Connect a wallet on ${dep.name} to check this certificate.` };
    if ((await provider.getCode(dep.address)) === "0x") return { error: `No registry contract at ${short(dep.address)} on ${dep.name}.` };
    return { dep, contract: new ethers.Contract(dep.address, cfg.abi, provider) };
  }

  async function readInput() {
    const f = $("file").files && $("file").files[0];
    if (f) {
      if (f.size > 10000) throw new Error("certificate file is missing or too large");
      return f.text();
    }
    return $("paste").value;
  }

  function show(res) {
    const [title, kind] = VERDICTS[res.verdict];
    $("result").hidden = false;
    $("result").dataset.kind = kind;
    $("verdict").textContent = title;
    $("reason").textContent = res.reason;
    const dl = $("details");
    dl.replaceChildren();
    const c = res.cert;
    if (!c) return;
    const rows = [["Student", c.recipient], ["Course", c.course], ["Certificate ID", c.id], ["Date on file", c.issuedOn], ["Issuer", c.issuer]];
    if (res.certHash) rows.push(["Recorded on-chain", when(res.issuedAt)], ["Revoked", when(res.revokedAt)], ["Fingerprint", res.certHash]);
    for (const [k, v] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      dd.textContent = v; // untrusted text: never innerHTML
      dl.append(dt, dd);
    }
  }

  async function onVerify() {
    const btn = $("verify");
    btn.disabled = true;
    try {
      const text = await readInput();
      let cert;
      try {
        cert = Certificate.parse(text);
      } catch (e) {
        show({ verdict: "BAD_FILE", reason: e.message });
        return;
      }
      const reg = await registryFor(cert.chainId);
      if (reg.error) {
        show({ verdict: "WRONG_REGISTRY", reason: reg.error, cert });
        return;
      }
      show(await verifyDocument(reg.contract, text, { address: reg.dep.address, chainId: cert.chainId }));
    } catch (e) {
      setStatus(friendlyError(e), "error");
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- wallet: issuers only ----------
  async function connect() {
    if (!window.ethereum) {
      setStatus("No wallet found. Install MetaMask to issue certificates. (Verifying works without one.)", "error");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      await setup(accounts[0]);
    } catch (e) {
      setStatus(friendlyError(e), "error");
    }
  }

  async function setup(account) {
    const gen = ++state.gen; // a newer setup() wins if the wallet changes mid-way
    const stale = () => gen !== state.gen;
    Object.assign(state, { signer: null, isIssuer: false, isAdmin: false });
    $("issuer-box").hidden = true;
    if (!account) {
      $("account").textContent = "";
      return;
    }
    state.provider = new ethers.BrowserProvider(window.ethereum);
    state.chainId = Number((await state.provider.getNetwork()).chainId);
    if (stale()) return;
    state.account = ethers.getAddress(account);
    $("account").textContent = "Account " + short(state.account);
    const reg = await registryFor(state.chainId);
    if (stale()) return;
    if (reg.error) {
      setStatus(reg.error, "error");
      return;
    }
    const c = reg.contract;
    const [issuerRole, adminRole] = await Promise.all([c.ISSUER_ROLE(), c.DEFAULT_ADMIN_ROLE()]);
    const [isIssuer, isAdmin] = await Promise.all([c.hasRole(issuerRole, state.account), c.hasRole(adminRole, state.account)]);
    if (stale()) return;
    state.signer = await state.provider.getSigner(state.account);
    Object.assign(state, { isIssuer, isAdmin, dep: reg.dep });
    $("issuer-box").hidden = !(isIssuer || isAdmin);
    $("issue").disabled = !isIssuer;
    setStatus(isIssuer ? "Connected as an issuer." : isAdmin ? "Connected as the admin (can revoke)." : "Connected. This account is not an issuer: you can verify only.", "ok");
  }

  function writable() {
    return new ethers.Contract(state.dep.address, cfg.abi, state.signer);
  }

  async function onIssue(ev) {
    ev.preventDefault();
    const btn = $("issue");
    btn.disabled = true;
    try {
      const cert = Certificate.create({
        registry: state.dep.address,
        chainId: state.chainId,
        issuer: state.account,
        id: $("certid").value,
        recipient: $("recipient").value,
        course: $("course").value,
        issuedOn: $("date").value,
      });
      setStatus("Confirm the transaction in your wallet…");
      const tx = await writable().issue(Certificate.hash(cert));
      setStatus("Waiting for the block…");
      await tx.wait();
      const json = JSON.stringify(cert, null, 2);
      if (state.downloadUrl) URL.revokeObjectURL(state.downloadUrl);
      state.downloadUrl = URL.createObjectURL(new Blob([json + "\n"], { type: "application/json" }));
      const a = $("download");
      a.href = state.downloadUrl;
      a.download = `certificate-${cert.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`;
      a.hidden = false;
      $("paste").value = json;
      setStatus(`Issued ${cert.id}. Download the file and send it to the student.`, "ok");
    } catch (e) {
      setStatus(e && e.message && !e.code && !e.data ? "Check the form: " + e.message : friendlyError(e), "error");
    } finally {
      btn.disabled = !state.isIssuer;
    }
  }

  async function onRevoke() {
    const btn = $("revoke");
    btn.disabled = true;
    try {
      const cert = Certificate.parse($("paste").value);
      setStatus("Confirm the revocation in your wallet…");
      const tx = await writable().revoke(cert.issuer, Certificate.hash(cert), $("reason-in").value);
      await tx.wait();
      setStatus(`Revoked ${cert.id}.`, "ok");
      await onVerify();
    } catch (e) {
      setStatus(e && e.message && !e.code && !e.data ? "Paste a valid certificate first: " + e.message : friendlyError(e), "error");
    } finally {
      btn.disabled = false;
    }
  }

  $("verify").addEventListener("click", onVerify);
  $("connect").addEventListener("click", connect);
  $("issue-form").addEventListener("submit", onIssue);
  $("revoke").addEventListener("click", onRevoke);
  $("file").addEventListener("change", () => ($("paste").value = ""));
  $("paste").addEventListener("input", () => ($("file").value = "")); // one source at a time
  // Today's date in the ISSUER'S time zone. toISOString() alone is UTC, which in Nepal
  // (UTC+5:45) shows yesterday's date before 5:45 am (QA finding L1).
  const now = new Date();
  $("date").value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", (a) => setup(a && a[0]).catch((e) => setStatus(friendlyError(e), "error")));
    window.ethereum.on("chainChanged", () => window.location.reload());
  }
})();
