const express = require("express");
const path = require("path");
const { Worker } = require("worker_threads");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 3000;

const VALID_ADDRESS_TYPES = new Set(["p2tr", "p2wpkh", "p2pkh"]);
const VALID_NETWORKS = new Set(["bitcoin", "testnet"]);
const BECH32_CHARSET = new Set("qpzry9x8gf2tvdw0s3jn54khce6mua7l");
const BASE58_CHARSET = new Set(
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
);

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

const state = {
  status: "idle",
  attempts: 0,
  startedAt: null,
  lastUpdatedAt: null,
  match: null,
  error: null,
  config: null,
};

let worker = null;

function resetRuntimeState() {
  state.attempts = 0;
  state.startedAt = null;
  state.lastUpdatedAt = null;
  state.match = null;
  state.error = null;
}

function normalizeInput(body) {
  const suffix = String(body.suffix || "").trim();
  const addressType = String(body.addressType || "p2tr").toLowerCase();
  const network = String(body.network || "bitcoin").toLowerCase();
  return { suffix, addressType, network };
}

function validateSuffixChars(suffix, addressType) {
  if (!suffix) {
    return "Suffix is required.";
  }

  if (addressType === "p2pkh") {
    const normalized = suffix.toLowerCase();
    for (const char of normalized) {
      if (!BASE58_CHARSET.has(char) && !BASE58_CHARSET.has(char.toUpperCase())) {
        return "Suffix contains characters not valid for Base58 addresses.";
      }
    }
    return null;
  }

  const normalized = suffix.toLowerCase();
  for (const char of normalized) {
    if (!BECH32_CHARSET.has(char)) {
      return "Suffix contains characters not valid for bech32 addresses.";
    }
  }
  return null;
}

function computeRate(attempts, startedAt) {
  if (!startedAt) {
    return 0;
  }
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  if (elapsedSeconds <= 0) {
    return 0;
  }
  return Math.floor(attempts / elapsedSeconds);
}

app.post("/api/start", (req, res) => {
  if (state.status === "running") {
    return res.status(409).json({ error: "A job is already running." });
  }

  const input = normalizeInput(req.body);
  if (!VALID_ADDRESS_TYPES.has(input.addressType)) {
    return res.status(400).json({ error: "Unsupported address type." });
  }
  if (!VALID_NETWORKS.has(input.network)) {
    return res.status(400).json({ error: "Unsupported network." });
  }

  const suffixError = validateSuffixChars(input.suffix, input.addressType);
  if (suffixError) {
    return res.status(400).json({ error: suffixError });
  }

  resetRuntimeState();
  state.status = "running";
  state.startedAt = Date.now();
  state.lastUpdatedAt = Date.now();
  state.config = input;

  worker = new Worker(path.join(__dirname, "worker.js"), {
    workerData: input,
  });

  worker.on("message", (msg) => {
    if (msg.type === "progress") {
      state.attempts = msg.attempts;
      state.lastUpdatedAt = Date.now();
      return;
    }

    if (msg.type === "found") {
      state.status = "found";
      state.attempts = msg.attempts;
      state.lastUpdatedAt = Date.now();
      state.match = {
        address: msg.address,
        privateKeyWif: msg.privateKeyWif,
        privateKeyHex: msg.privateKeyHex,
        publicKeyHex: msg.publicKeyHex,
        durationMs: msg.durationMs,
      };
      return;
    }

    if (msg.type === "error") {
      state.status = "error";
      state.error = msg.error || "Worker failed.";
    }
  });

  worker.on("error", (err) => {
    state.status = "error";
    state.error = err.message || "Worker error.";
    worker = null;
  });

  worker.on("exit", (code) => {
    if (state.status === "stopping") {
      state.status = "stopped";
    } else if (state.status === "running") {
      state.status = code === 0 ? "stopped" : "error";
      if (code !== 0 && !state.error) {
        state.error = `Worker exited with code ${code}.`;
      }
    }
    worker = null;
  });

  return res.status(202).json({ ok: true });
});

app.post("/api/stop", (req, res) => {
  if (!worker || state.status !== "running") {
    return res.status(409).json({ error: "No running job." });
  }

  const activeWorker = worker;
  state.status = "stopping";
  activeWorker
    .terminate()
    .then(() => {
      if (state.status === "stopping") {
        state.status = "stopped";
      }
      worker = null;
    })
    .catch((err) => {
      state.status = "error";
      state.error = err && err.message ? err.message : "Failed to stop worker.";
      worker = null;
    });

  return res.json({ ok: true });
});

app.get("/api/status", (req, res) => {
  const rate = computeRate(state.attempts, state.startedAt);
  const elapsedMs = state.startedAt ? Date.now() - state.startedAt : 0;
  return res.json({
    status: state.status,
    attempts: state.attempts,
    ratePerSecond: rate,
    elapsedMs,
    startedAt: state.startedAt,
    config: state.config,
    match: state.match,
    error: state.error,
  });
});

app.listen(PORT, HOST, () => {
  process.stdout.write(`Listening on http://${HOST}:${PORT}\n`);
});
