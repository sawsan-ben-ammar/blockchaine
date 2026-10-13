// Issuer page: needs MetaMask and a wallet with ISSUER_ROLE (or admin).
const $ = (id) => document.getElementById(id);
let provider, signer, contract, account;
let canIssue = false;
let switching = false; // true while we ask MetaMask to change network

// ---------- Wallet connection and network check ----------

async function ensureRightNetwork() {
  const net = selectedNetwork();
  const wanted = ethers.toQuantity(net.chainId); // e.g. 0xaa36a7 for Sepolia
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (current.toLowerCase() === wanted.toLowerCase()) return;
  switching = true;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: wanted }],
    });
  } catch (e) {
    if (e.code !== 4902) throw e; // 4902 = MetaMask does not know this network yet
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: wanted,
          chainName:
            selectedNetworkName() === "localhost" ? "Hardhat Local" : selectedNetworkName(),
          rpcUrls: [net.readRpc],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
        },
      ],
    });
  } finally {
    switching = false;
  }
}

async function connect() {
  const status = $("walletStatus");
  setStatus(status, "info", "Connecting...");
  try {
    if (!window.ethereum) throw new Error("MetaMask is not installed in this browser");
    const net = selectedNetwork();
    if (!net) throw new Error("No deployment found in js/config.js");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await ensureRightNetwork();

    provider = new ethers.BrowserProvider(window.ethereum); // created after the switch
    signer = await provider.getSigner();
    account = await signer.getAddress();
    contract = new ethers.Contract(net.address, ABI, signer);

    const [issuerRole, adminRole] = await Promise.all([
      contract.ISSUER_ROLE(),
      contract.DEFAULT_ADMIN_ROLE(),
    ]);
    const [isIssuer, isAdmin, name] = await Promise.all([
      contract.hasRole(issuerRole, account),
      contract.hasRole(adminRole, account),
      contract.institutionName(account),
    ]);
    canIssue = isIssuer;
    const role = isAdmin
      ? "Admin + issuer"
      : isIssuer
        ? "Issuer"
        : "No issuer role (read-only)";
    setStatus(
      status,
      isIssuer ? "ok" : "warn",
      `Connected: <code>${shortAddr(account)}</code> on ${selectedNetworkName()}<br>` +
        `Role: <b>${role}</b>${name ? ` - ${escapeHtml(name)}` : ""}`,
    );
    $("adminCard").hidden = !isAdmin;
    $("connect").textContent = "Reconnect";
  } catch (e) {
    setStatus(status, "bad", "Error: " + errorMessage(e));
  }
}

async function needContract() {
  if (!contract) await connect();
  if (!contract) throw new Error("Connect MetaMask first");
}

async function needIssuer() {
  await needContract();
  if (!canIssue) throw new Error("This wallet does not have the issuer role");
}

async function waitForTx(tx, out, doneHtml) {
  setStatus(
    out,
    "info",
    `Transaction sent, waiting for confirmation... ${explorerLink("tx", tx.hash)}`,
  );
  await tx.wait();
  setStatus(out, "ok", `${doneHtml}<br>${explorerLink("tx", tx.hash)}`);
}

// ---------- Issue one diploma ----------

async function issueOne() {
  const out = $("issueResult");
  setStatus(out, "info", "Working...");
  $("receipt").hidden = true;
  try {
    await needIssuer();
    const file = $("issueFile").files[0];
    if (!file) throw new Error("Choose a diploma file first");

    const salt = newSalt();
    const hash = await certificateHash(file, salt);
    if ((await contract.verifyCertificate(hash)).exists) throw new Error("Already issued");

    setStatus(out, "info", "Confirm the transaction in MetaMask...");
    const tx = await contract.issueCertificate(hash);
    await waitForTx(
      tx,
      out,
      "<strong>Issued.</strong> Give the student the file AND the salt (or the QR code).",
    );
    showReceipt({ file: file.name, salt, hash, tx: tx.hash });
  } catch (e) {
    setStatus(out, "bad", "Error: " + errorMessage(e));
  }
}

function showReceipt(r) {
  const link = verifyUrl(r.salt);
  $("rSalt").textContent = r.salt;
  $("rHash").textContent = r.hash;
  $("rLink").href = link;
  $("qrcode").innerHTML = "";
  new QRCode($("qrcode"), { text: link, width: 180, height: 180 });
  $("downloadReceipt").onclick = () =>
    downloadText(
      `${r.file}.receipt.json`,
      JSON.stringify({ ...r, network: selectedNetworkName(), verifyUrl: link }, null, 2),
      "application/json",
    );
  $("receipt").hidden = false;
}

// ---------- Issue a whole class at once ----------

async function issueBatch() {
  const out = $("batchResult");
  setStatus(out, "info", "Working...");
  try {
    await needIssuer();
    const files = Array.from($("batchFiles").files);
    if (files.length === 0) throw new Error("Choose one or more diploma files");
    if (files.length > 100) throw new Error("100 files maximum per batch");

    setStatus(out, "info", `Hashing ${files.length} files...`);
    const rows = [];
    for (const f of files) {
      const salt = newSalt();
      rows.push({ file: f.name, salt, hash: await certificateHash(f, salt) });
    }

    setStatus(out, "info", "Confirm the transaction in MetaMask...");
    const tx = await contract.issueBatch(rows.map((r) => r.hash));
    await waitForTx(
      tx,
      out,
      `<strong>${rows.length} diplomas issued in one transaction.</strong> ` +
        "The CSV with each salt and verification link was downloaded.",
    );

    const csv = ["file,salt,hash,verify_url"]
      .concat(
        rows.map(
          (r) => `"${r.file.replace(/"/g, '""')}",${r.salt},${r.hash},${verifyUrl(r.salt)}`,
        ),
      )
      .join("\n");
    downloadText("batch-receipts.csv", csv, "text/csv");
  } catch (e) {
    setStatus(out, "bad", "Error: " + errorMessage(e));
  }
}

// ---------- Revoke ----------

async function revoke() {
  const out = $("revokeResult");
  setStatus(out, "info", "Working...");
  try {
    await needContract();
    let hash = $("revokeHash").value.trim();
    if (!hash) {
      const file = $("revokeFile").files[0];
      if (!file) throw new Error("Give the certificate hash, or the file + its salt");
      hash = await certificateHash(file, $("revokeSalt").value.trim());
    }
    if (!ethers.isHexString(hash, 32)) throw new Error("Invalid hash");
    const reason = $("revokeReason").value.trim() || "No reason given";

    const r = await contract.verifyCertificate(hash);
    if (!r.exists) throw new Error("Not found");
    if (!r.valid) throw new Error("Already revoked");

    setStatus(out, "info", "Confirm the transaction in MetaMask...");
    const tx = await contract.revokeCertificate(hash, reason);
    await waitForTx(tx, out, `<strong>Revoked.</strong> Reason: ${escapeHtml(reason)}`);
  } catch (e) {
    setStatus(out, "bad", "Error: " + errorMessage(e));
  }
}

// ---------- Admin: institutions ----------

async function addInstitution() {
  const out = $("adminResult");
  setStatus(out, "info", "Working...");
  try {
    await needContract();
    const addr = $("instAddress").value.trim();
    const name = $("instName").value.trim();
    if (!ethers.isAddress(addr)) throw new Error("Invalid wallet address");
    if (!name) throw new Error("Enter the institution name");
    setStatus(out, "info", "Confirm the transaction in MetaMask...");
    const tx = await contract.addIssuer(addr, name);
    await waitForTx(
      tx,
      out,
      `<strong>${escapeHtml(name)}</strong> can now issue diplomas.`,
    );
  } catch (e) {
    setStatus(out, "bad", "Error: " + errorMessage(e));
  }
}

async function removeInstitution() {
  const out = $("adminResult");
  setStatus(out, "info", "Working...");
  try {
    await needContract();
    const addr = $("instAddress").value.trim();
    if (!ethers.isAddress(addr)) throw new Error("Invalid wallet address");
    setStatus(out, "info", "Confirm the transaction in MetaMask...");
    const tx = await contract.removeIssuer(addr);
    await waitForTx(tx, out, "Issuer removed. Its old diplomas stay valid.");
  } catch (e) {
    setStatus(out, "bad", "Error: " + errorMessage(e));
  }
}

// ---------- Wiring ----------

fillNetworkSelect($("network"), () => {
  contract = null;
  connect();
});
$("connect").onclick = connect;
$("issueBtn").onclick = issueOne;
$("batchBtn").onclick = issueBatch;
$("revokeBtn").onclick = revoke;
$("addInstBtn").onclick = addInstitution;
$("removeInstBtn").onclick = removeInstitution;

if (window.ethereum) {
  // Switching account or network in MetaMask: start again cleanly
  window.ethereum.on("accountsChanged", () => window.location.reload());
  window.ethereum.on("chainChanged", () => {
    if (!switching) window.location.reload();
  });
}
