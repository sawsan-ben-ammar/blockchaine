// Shared code for issuer.html and verify.html
// Needs: ethers v6 (UMD) and js/config.js loaded before this file.

const ABI = [
  "function ISSUER_ROLE() view returns (bytes32)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function institutionName(address) view returns (string)",
  "function totalIssued() view returns (uint256)",
  "function addIssuer(address issuer, string name)",
  "function removeIssuer(address issuer)",
  "function issueCertificate(bytes32 hash)",
  "function issueBatch(bytes32[] hashes)",
  "function revokeCertificate(bytes32 hash, string reason)",
  "function verifyCertificate(bytes32 hash) view returns (bool exists, bool valid, " +
    "address issuer, string institution, uint64 issuedAt, uint64 revokedAt)",
  // OpenZeppelin custom error, so ethers can decode it
  "error AccessControlUnauthorizedAccount(address account, bytes32 neededRole)",
];

// ---------- Network config (written by scripts/deploy.js) ----------

function networks() {
  return (window.APP_CONFIG && window.APP_CONFIG.networks) || {};
}

// Network chosen in the page's dropdown, saved per browser
function selectedNetworkName() {
  const names = Object.keys(networks());
  let saved = null;
  try {
    saved = localStorage.getItem("network");
  } catch (e) {}
  if (saved && names.includes(saved)) return saved;
  return names.includes("sepolia") ? "sepolia" : names[0];
}

function selectedNetwork() {
  return networks()[selectedNetworkName()];
}

function fillNetworkSelect(selectEl, onChange) {
  const names = Object.keys(networks());
  if (names.length === 0) {
    selectEl.innerHTML = "<option>No deployment yet: run scripts/deploy.js</option>";
    selectEl.disabled = true;
    return;
  }
  selectEl.innerHTML = names
    .map((n) => `<option value="${n}">${n} (chain ${networks()[n].chainId})</option>`)
    .join("");
  selectEl.value = selectedNetworkName();
  selectEl.onchange = () => {
    try {
      localStorage.setItem("network", selectEl.value);
    } catch (e) {}
    if (onChange) onChange();
  };
}

// ---------- Hashing (runs in the browser, the file never leaves the computer) ----------

async function readFileBytes(file) {
  return new Uint8Array(await file.arrayBuffer());
}

function newSalt() {
  return ethers.hexlify(ethers.randomBytes(32)); // 32 random bytes
}

function isValidSalt(salt) {
  return ethers.isHexString(salt, 32);
}

// certificateHash = keccak256(keccak256(fileBytes) || salt)
// Must stay identical to CertificateRegistry.computeHash and to the tests.
async function certificateHash(file, salt) {
  if (!isValidSalt(salt))
    throw new Error("The salt must be 0x followed by 64 hex characters");
  const fileHash = ethers.keccak256(await readFileBytes(file));
  return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [fileHash, salt]);
}

// ---------- Helpers ----------

function formatDate(seconds) {
  return new Date(Number(seconds) * 1000).toLocaleString();
}

// Institution names come from the blockchain: escape them before putting them in HTML
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : "";
}

function explorerLink(kind, value) {
  const net = selectedNetwork();
  if (!net || !net.explorer) return "";
  const url = `${net.explorer}/${kind}/${value}`;
  return `<a href="${url}" target="_blank" rel="noopener">view on Etherscan</a>`;
}

function verifyUrl(salt) {
  // The salt goes after "#": browsers never send that part to any server
  const base = new URL("verify.html", window.location.href).href;
  return `${base}#salt=${salt}&net=${selectedNetworkName()}`;
}

// Turn ethers / MetaMask errors into a readable sentence
function errorMessage(e) {
  if (e && e.code === "ACTION_REJECTED") return "Transaction cancelled in MetaMask.";
  if (e && e.revert && e.revert.name === "AccessControlUnauthorizedAccount")
    return "This wallet does not have the required role.";
  if (e && e.reason) return e.reason;
  if (e && e.shortMessage) return e.shortMessage;
  return (e && e.message) || String(e);
}

function setStatus(el, kind, html) {
  el.className = `status ${kind}`;
  el.innerHTML = html;
}

function downloadText(filename, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
