const { parentPort, workerData } = require("worker_threads");
const { randomBytes } = require("crypto");
const { performance } = require("perf_hooks");
const bitcoin = require("bitcoinjs-lib");
const ecc = require("tiny-secp256k1");
const ECPairFactory = require("ecpair").ECPairFactory;

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const NETWORKS = {
  bitcoin: bitcoin.networks.bitcoin,
  testnet: bitcoin.networks.testnet,
};

const BATCH_SIZE = 10_000;
const REPORT_EVERY = 5_000;

const input = {
  suffix: workerData.suffix,
  addressType: workerData.addressType,
  network: workerData.network,
};

let shouldStop = false;
let attempts = 0;
const startedAt = performance.now();

parentPort.on("message", (msg) => {
  if (msg && msg.type === "stop") {
    shouldStop = true;
  }
});

function toXOnly(pubKey) {
  const key = Buffer.from(pubKey);
  return key.length === 32 ? key : key.subarray(1, 33);
}

function deriveAddress(keyPair, addressType, network) {
  const pubkey = Buffer.from(keyPair.publicKey);

  if (addressType === "p2pkh") {
    return bitcoin.payments.p2pkh({
      pubkey,
      network,
    }).address;
  }

  if (addressType === "p2wpkh") {
    return bitcoin.payments.p2wpkh({
      pubkey,
      network,
    }).address;
  }

  return bitcoin.payments.p2tr({
    internalPubkey: toXOnly(pubkey),
    network,
  }).address;
}

function isMatch(address, suffix) {
  return address.toLowerCase().endsWith(suffix.toLowerCase());
}

function sendProgress(force = false) {
  if (force || attempts % REPORT_EVERY === 0) {
    parentPort.postMessage({
      type: "progress",
      attempts,
    });
  }
}

function run() {
  const network = NETWORKS[input.network];
  if (!network) {
    parentPort.postMessage({ type: "error", error: "Invalid network." });
    return;
  }

  while (!shouldStop) {
    for (let i = 0; i < BATCH_SIZE && !shouldStop; i += 1) {
      const keyPair = ECPair.makeRandom({
        network,
        rng: (size) => randomBytes(size),
      });

      const address = deriveAddress(keyPair, input.addressType, network);
      attempts += 1;

      if (isMatch(address, input.suffix)) {
        const durationMs = Math.floor(performance.now() - startedAt);
        parentPort.postMessage({
          type: "found",
          attempts,
          address,
          privateKeyWif: keyPair.toWIF(),
          privateKeyHex: Buffer.from(keyPair.privateKey).toString("hex"),
          publicKeyHex: Buffer.from(keyPair.publicKey).toString("hex"),
          durationMs,
        });
        return;
      }
    }

    sendProgress();
  }

  sendProgress(true);
}

try {
  run();
} catch (err) {
  parentPort.postMessage({
    type: "error",
    error: err && err.message ? err.message : "Unknown worker error.",
  });
}
