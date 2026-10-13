// Verifier page: read-only, no MetaMask, no transaction, free.
const $ = (id) => document.getElementById(id);

function readContract() {
  const net = selectedNetwork();
  if (!net) throw new Error("No deployment found in js/config.js");
  // Plain JSON-RPC provider: works without any wallet installed
  const provider = new ethers.JsonRpcProvider(net.readRpc, net.chainId, {
    staticNetwork: true,
  });
  return new ethers.Contract(net.address, ABI, provider);
}

// A QR code / link gives verify.html#salt=0x...&net=sepolia
function readParamsFromLink() {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const salt = params.get("salt");
  const net = params.get("net");
  if (net && networks()[net]) {
    try {
      localStorage.setItem("network", net);
    } catch (e) {}
  }
  if (salt) {
    $("salt").value = salt;
    $("saltHint").textContent = "Salt filled in from the QR code / link.";
  }
}

function showContractInfo() {
  const net = selectedNetwork();
  $("contractInfo").innerHTML = net
    ? `Contract <code>${shortAddr(net.address)}</code> on ${selectedNetworkName()} ` +
      explorerLink("address", net.address)
    : "";
}

async function verify() {
  const out = $("result");
  setStatus(out, "info", "Working...");
  try {
    const file = $("file").files[0];
    if (!file) throw new Error("Choose the diploma file first");
    const salt = $("salt").value.trim();
    setStatus(out, "info", "Computing the hash in your browser...");
    const hash = await certificateHash(file, salt);

    setStatus(out, "info", "Asking the blockchain...");
    const r = await readContract().verifyCertificate(hash);

    if (!r.exists) {
      setStatus(
        out,
        "bad",
        `<strong>NOT FOUND</strong><br>This file (with this salt) was never registered. ` +
          `It may have been modified, or the salt is wrong.` +
          `<br><small>Hash: <code>${hash}</code></small>`,
      );
    } else if (!r.valid) {
      setStatus(
        out,
        "warn",
        `<strong>REVOKED</strong><br>Issued by <b>${escapeHtml(r.institution)}</b> ` +
          `on ${formatDate(r.issuedAt)}, revoked on ${formatDate(r.revokedAt)}.` +
          `<br><small>Hash: <code>${hash}</code></small>`,
      );
    } else {
      setStatus(
        out,
        "ok",
        `<strong>VALID</strong><br>Issued by <b>${escapeHtml(r.institution)}</b> ` +
          `(<code>${shortAddr(r.issuer)}</code>) on ${formatDate(r.issuedAt)}.` +
          `<br><small>Hash: <code>${hash}</code></small>`,
      );
    }
  } catch (e) {
    setStatus(out, "bad", "Error: " + errorMessage(e));
  }
}

readParamsFromLink();
fillNetworkSelect($("network"), showContractInfo);
showContractInfo();
$("verifyBtn").onclick = verify;
