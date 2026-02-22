const form = document.getElementById("generatorForm");
const suffixEl = document.getElementById("suffix");
const addressTypeEl = document.getElementById("addressType");
const networkEl = document.getElementById("network");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const stateEl = document.getElementById("state");
const attemptsEl = document.getElementById("attempts");
const rateEl = document.getElementById("rate");
const elapsedEl = document.getElementById("elapsed");
const errorEl = document.getElementById("error");
const typeHintEl = document.getElementById("typeHint");

const resultAddressEl = document.getElementById("resultAddress");
const resultWifEl = document.getElementById("resultWif");
const resultPrivHexEl = document.getElementById("resultPrivHex");
const resultPubHexEl = document.getElementById("resultPubHex");

let pollHandle = null;

function setTypeHint() {
  const type = addressTypeEl.value;
  if (type === "p2pkh") {
    typeHintEl.textContent =
      "Base58 addresses are mixed-case. Matching is case-insensitive.";
    return;
  }
  typeHintEl.textContent =
    "Bech32 addresses are typically lowercase; matching is case-insensitive.";
}

function updateButtons(status) {
  const running = status === "running" || status === "stopping";
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function clearResult() {
  resultAddressEl.textContent = "-";
  resultWifEl.textContent = "-";
  resultPrivHexEl.textContent = "-";
  resultPubHexEl.textContent = "-";
}

function renderStatus(data) {
  stateEl.textContent = data.status;
  attemptsEl.textContent = formatNumber(data.attempts);
  rateEl.textContent = `${formatNumber(data.ratePerSecond)}/s`;
  elapsedEl.textContent = `${(data.elapsedMs / 1000).toFixed(1)}s`;
  errorEl.textContent = data.error || "";
  updateButtons(data.status);

  if (data.match) {
    resultAddressEl.textContent = data.match.address;
    resultWifEl.textContent = data.match.privateKeyWif;
    resultPrivHexEl.textContent = data.match.privateKeyHex;
    resultPubHexEl.textContent = data.match.publicKeyHex;
  }
}

async function fetchStatus() {
  try {
    const resp = await fetch("/api/status");
    const data = await resp.json();
    renderStatus(data);
  } catch (err) {
    errorEl.textContent = err.message || "Failed to fetch status.";
  }
}

function startPolling() {
  if (pollHandle) {
    clearInterval(pollHandle);
  }
  pollHandle = setInterval(fetchStatus, 1000);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearResult();
  errorEl.textContent = "";

  const payload = {
    suffix: suffixEl.value,
    addressType: addressTypeEl.value,
    network: networkEl.value,
  };

  try {
    const resp = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || "Failed to start");
    }
    await fetchStatus();
  } catch (err) {
    errorEl.textContent = err.message || "Failed to start search.";
  }
});

stopBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  try {
    const resp = await fetch("/api/stop", { method: "POST" });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data.error || "Failed to stop");
    }
    await fetchStatus();
  } catch (err) {
    errorEl.textContent = err.message || "Failed to stop search.";
  }
});

addressTypeEl.addEventListener("change", setTypeHint);

setTypeHint();
startPolling();
fetchStatus();
