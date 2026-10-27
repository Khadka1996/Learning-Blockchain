/* TipJar frontend — plain JavaScript + ethers v6 (vendor/ethers.umd.min.js) + any
 * EIP-1193 wallet (MetaMask injects `window.ethereum`).
 *
 * The three layers of a dApp:
 *   this page (UI)  ──asks──▶  wallet (holds the key, shows a confirm popup)
 *                   ──sends──▶ RPC node ──▶ TipJar contract on the chain
 *
 * Security rules this file follows:
 *   - Tip messages are UNTRUSTED: shown with textContent, never innerHTML.
 *   - Never trust the config blindly: check there is code at the address.
 *   - The page never sees a private key; only the wallet signs.
 */
(function () {
  "use strict";

  const ethers = window.ethers;
  const cfg = window.DAPP_CONFIG || { deployments: {}, abi: [] };
  const $ = (id) => document.getElementById(id);
  const iface = new ethers.Interface(cfg.abi);

  const state = { provider: null, signer: null, account: null, chainId: null, jar: null, dep: null, owner: null, min: 0n, maxBytes: 140, timer: null, busy: false, gen: 0 };

  // ---------- small helpers ----------
  function setStatus(text, kind) {
    const el = $("status");
    el.textContent = text;
    el.dataset.kind = kind || "info";
  }
  const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
  const eth = (wei) => Number(ethers.formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " ETH";
  const byteLength = (s) => new TextEncoder().encode(s).length;

  const ERROR_TEXT = {
    TipTooSmall: () => `The smallest tip is ${ethers.formatEther(state.min)} ETH.`,
    EmptyMessage: () => "Please write a message.",
    MessageTooLong: (a) => `Message is ${a[0]} bytes; the limit is ${a[1]}.`,
    NotOwner: () => "Only the owner can withdraw.",
    NothingToWithdraw: () => "The jar is empty.",
    ZeroAddress: () => "Invalid withdraw address.",
    TransferFailed: () => "The withdrawal transfer failed.",
  };

  /** Turn wallet / RPC / contract errors into one plain sentence. */
  function friendlyError(e) {
    const code = e && (e.code ?? (e.info && e.info.error && e.info.error.code));
    if (code === 4001 || code === "ACTION_REJECTED") return "You cancelled the request in your wallet.";
    if (code === "INSUFFICIENT_FUNDS") return "Not enough ETH in this account for the tip plus gas.";
    if (e && e.revert && ERROR_TEXT[e.revert.name]) return ERROR_TEXT[e.revert.name](e.revert.args);
    const data = e && (e.data || (e.info && e.info.error && e.info.error.data) || (e.error && e.error.data));
    if (typeof data === "string" && data.startsWith("0x")) {
      try {
        const parsed = iface.parseError(data);
        if (parsed && ERROR_TEXT[parsed.name]) return ERROR_TEXT[parsed.name](parsed.args);
      } catch {
        /* not one of ours */
      }
    }
    return "Something went wrong: " + ((e && (e.shortMessage || e.message)) || String(e));
  }

  // ---------- connect & network ----------
  async function connect() {
    if (!window.ethereum) {
      setStatus("No wallet found. Install MetaMask (metamask.io), then reload this page.", "error");
      return;
    }
    try {
      $("connect").disabled = true;
      setStatus("Approve the connection in your wallet…");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      await setup(accounts[0]);
    } catch (e) {
      setStatus(friendlyError(e), "error");
    } finally {
      $("connect").disabled = false;
    }
  }

  async function setup(account) {
    teardown();
    // Each setup() gets a number. If the wallet fires accountsChanged again while
    // we are still awaiting, the older setup sees a newer number and stops — so
    // only ONE polling timer ever exists (QA finding L1).
    const gen = ++state.gen;
    const stale = () => gen !== state.gen;
    state.provider = new ethers.BrowserProvider(window.ethereum);
    state.chainId = Number((await state.provider.getNetwork()).chainId);
    if (stale()) return;
    state.account = ethers.getAddress(account);
    $("account").textContent = "Account " + short(state.account);

    const dep = cfg.deployments[state.chainId];
    if (!dep) {
      const supported = Object.entries(cfg.deployments).map(([id, d]) => `${d.name} (${id})`).join(", ") || "none";
      $("network").textContent = "Chain " + state.chainId;
      setStatus(`TipJar is not deployed on this network. Supported: ${supported}.`, "error");
      $("switch").hidden = Object.keys(cfg.deployments).length === 0;
      return;
    }
    // The config could be stale (e.g. local node restarted). No code = no contract.
    const code = await state.provider.getCode(dep.address);
    if (stale()) return;
    if (code === "0x") {
      setStatus(`No contract at ${short(dep.address)} on ${dep.name}. Redeploy (npm run deploy:local) and reload.`, "error");
      return;
    }
    state.dep = dep;
    state.signer = await state.provider.getSigner(state.account);
    if (stale()) return;
    state.jar = new ethers.Contract(dep.address, cfg.abi, state.signer);
    $("network").textContent = dep.name;
    $("contract").textContent = dep.address;
    const [owner, min, maxBytes] = await Promise.all([state.jar.owner(), state.jar.MIN_TIP(), state.jar.MAX_MESSAGE_BYTES()]);
    if (stale()) return;
    state.owner = owner;
    state.min = min;
    state.maxBytes = Number(maxBytes);
    $("owner-box").hidden = owner.toLowerCase() !== state.account.toLowerCase();
    $("send").disabled = false;
    $("connect").textContent = "Connected";
    setStatus("Connected. Send a tip below.", "ok");
    await refresh();
    if (stale()) return;
    state.timer = setInterval(refresh, 8000); // simple polling picks up other people's tips
  }

  function teardown() {
    if (state.timer) clearInterval(state.timer);
    Object.assign(state, { jar: null, signer: null, dep: null, timer: null });
    $("send").disabled = true;
    $("switch").hidden = true;
    $("owner-box").hidden = true;
  }

  async function switchNetwork() {
    const target = Object.keys(cfg.deployments)[0];
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x" + Number(target).toString(16) }] });
    } catch (e) {
      setStatus(friendlyError(e), "error");
    }
  }

  // ---------- read ----------
  async function refresh() {
    if (!state.jar) return;
    try {
      const [count, total, balance, tips] = await Promise.all([
        state.jar.tipCount(),
        state.jar.totalTipped(),
        state.provider.getBalance(state.dep.address),
        state.jar.getTips(0, 20),
      ]);
      $("count").textContent = count.toString();
      $("total").textContent = eth(total);
      $("balance").textContent = eth(balance);
      renderTips(tips);
    } catch (e) {
      setStatus(friendlyError(e), "error");
    }
  }

  function renderTips(tips) {
    const list = $("tips");
    list.replaceChildren();
    $("empty").hidden = tips.length > 0;
    for (const t of tips) {
      const li = document.createElement("li");
      const msg = document.createElement("p");
      msg.className = "tip-msg";
      msg.textContent = t.message; // untrusted text — NEVER innerHTML
      const meta = document.createElement("p");
      meta.className = "tip-meta";
      const from = ethers.getAddress(t.from);
      const who = document.createElement(state.dep.explorer ? "a" : "span");
      who.textContent = short(from);
      if (state.dep.explorer) {
        who.href = `${state.dep.explorer}/address/${from}`;
        who.target = "_blank";
        who.rel = "noopener noreferrer";
      }
      meta.append(who, ` · ${eth(t.amount)} · ${new Date(Number(t.timestamp) * 1000).toLocaleString()}`);
      li.append(msg, meta);
      list.append(li);
    }
  }

  // ---------- write ----------
  async function sendTip(ev) {
    ev.preventDefault();
    if (!state.jar || state.busy) return; // busy flag: no double-submits
    const message = $("message").value.trim();
    const len = byteLength(message);
    if (len === 0) return setStatus("Please write a message.", "error");
    if (len > state.maxBytes) return setStatus(`Message is ${len} bytes; the limit is ${state.maxBytes}.`, "error");
    let value;
    try {
      value = ethers.parseEther($("amount").value.trim());
    } catch {
      return setStatus("Enter the amount as a number, like 0.001", "error");
    }
    if (value < state.min) return setStatus(ERROR_TEXT.TipTooSmall(), "error");

    state.busy = true;
    $("send").disabled = true;
    try {
      setStatus("Confirm the tip in your wallet…");
      const tx = await state.jar.tip(message, { value });
      setStatus(`Sent (${short(tx.hash)}). Waiting for it to be included in a block…`);
      const receipt = await tx.wait();
      setStatus(`Tip confirmed in block ${receipt.blockNumber} ✓`, "ok");
      $("message").value = "";
      updateBytes();
      await refresh();
    } catch (e) {
      setStatus(friendlyError(e), "error");
    } finally {
      state.busy = false;
      $("send").disabled = !state.jar;
    }
  }

  async function withdraw() {
    if (!state.jar || state.busy) return;
    state.busy = true;
    $("withdraw").disabled = true;
    try {
      setStatus("Confirm the withdrawal in your wallet…");
      const receipt = await (await state.jar.withdraw(state.account)).wait();
      setStatus(`Withdrawn in block ${receipt.blockNumber} ✓`, "ok");
      await refresh();
    } catch (e) {
      setStatus(friendlyError(e), "error");
    } finally {
      state.busy = false;
      $("withdraw").disabled = false;
    }
  }

  function updateBytes() {
    const n = byteLength($("message").value.trim());
    $("bytes").textContent = `${n} / ${state.maxBytes} bytes`;
    $("bytes").style.color = n > state.maxBytes ? "var(--err)" : "";
  }

  // ---------- wire up ----------
  $("connect").addEventListener("click", connect);
  $("switch").addEventListener("click", switchNetwork);
  $("tip-form").addEventListener("submit", sendTip);
  $("withdraw").addEventListener("click", withdraw);
  $("message").addEventListener("input", updateBytes);

  if (window.ethereum && window.ethereum.on) {
    window.ethereum.on("accountsChanged", (accs) => {
      if (accs && accs.length) setup(accs[0]).catch((e) => setStatus(friendlyError(e), "error"));
      else {
        state.gen++; // cancel any setup() still in flight
        teardown();
        $("account").textContent = "";
        $("connect").textContent = "Connect wallet";
        setStatus("Wallet disconnected.");
      }
    });
    // MetaMask's advice: a new chain means new contract addresses — start clean.
    window.ethereum.on("chainChanged", () => window.location.reload());
  }
})();
