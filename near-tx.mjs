// Signs and sends one NEAR FunctionCall transaction with WebCrypto Ed25519, in the Worker and in Node alike.
// secretKey is "ed25519:<base58 of seed+public>", the format near-cli keeps. It is only ever passed in by the caller.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58decode(s) {
  let n = 0n;
  for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw Error("bad base58"); n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out);
}
export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}

const enc = new TextEncoder();
const u32 = (n) => Uint8Array.of(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255);
const u64 = (n) => { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(n), true); return o; };
const u128 = (n) => { const o = new Uint8Array(16); const v = new DataView(o.buffer); v.setBigUint64(0, BigInt(n) & ((1n << 64n) - 1n), true); v.setBigUint64(8, BigInt(n) >> 64n, true); return o; };
const str = (s) => { const b = enc.encode(s); return cat(u32(b.length), b); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

const pk = (publicKey) => cat(Uint8Array.of(0), publicKey);
export const functionCallAction = (method, args, gas, deposit) => { const body = enc.encode(JSON.stringify(args)); return cat(Uint8Array.of(2), str(method), u32(body.length), body, u64(gas), u128(deposit)); };
export const addFunctionCallKeyAction = (publicKey, receiverId, methods, allowance) => cat(Uint8Array.of(5), pk(publicKey), u64(0), Uint8Array.of(0), Uint8Array.of(1), u128(allowance), str(receiverId), u32(methods.length), ...methods.map(str));
export const deleteKeyAction = (publicKey) => cat(Uint8Array.of(6), pk(publicKey));

export function encodeTx({ signerId, publicKey, nonce, receiverId, blockHash, actions }) {
  return cat(str(signerId), pk(publicKey), u64(nonce), str(receiverId), blockHash, u32(actions.length), ...actions);
}

/* url is one endpoint or a list; a rate limit or a refused connection moves to the next endpoint, then backs off 1 s, 2 s, 4 s. */
export async function rpc(url, method, params) {
  const urls = [].concat(url);
  let last;
  for (let i = 0; i < 8; i++) {
    const u = urls[i % urls.length];
    try {
      const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(method === "send_tx" ? 90000 : 20000) });
      const j = await r.json();
      if (!j.error) return j.result;
      last = Error(method + ": " + (j.error.data || j.error.message || JSON.stringify(j.error)));
      if (!/rate|limit|timeout|busy|too many|deprecated/i.test(String(j.error.data || j.error.message))) throw last;
    } catch (e) {
      if (e === last) throw e;
      last = e;
    }
    await new Promise((res) => setTimeout(res, Math.min(8000, 1000 * 2 ** Math.floor(i / urls.length))));
  }
  throw last;
}

/* Signs the actions with secretKey and waits for the transaction to be final. Returns { hash, outcome }, outcome being the RPC's final result. */
export async function sendActions({ rpcUrl, signerId, secretKey, receiverId, actions }) {
  const raw = b58decode(secretKey.replace(/^ed25519:/, ""));
  const seed = raw.slice(0, 32), publicKey = raw.length === 64 ? raw.slice(32) : null;
  if (!publicKey) throw Error("secret key must carry its public half");
  const pkcs8 = cat(Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]), seed);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const pkStr = "ed25519:" + b58encode(publicKey);
  const ak = await rpc(rpcUrl, "query", { request_type: "view_access_key", finality: "final", account_id: signerId, public_key: pkStr });
  const block = await rpc(rpcUrl, "block", { finality: "final" });
  const tx = encodeTx({ signerId, publicKey, nonce: BigInt(ak.nonce) + 1n, receiverId, blockHash: b58decode(block.header.hash), actions });
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", tx));
  const sig = new Uint8Array(await crypto.subtle.sign("Ed25519", key, hash));
  const signed = cat(tx, Uint8Array.of(0), sig);
  const b64 = Buffer.from(signed).toString("base64");
  const txHash = b58encode(hash);
  // the same signed bytes are sent again if the first attempt is lost; a transaction is only ever applied once
  let outcome, lastErr;
  for (let attempt = 0; attempt < 5 && !outcome; attempt++) {
    try {
      if (signed.length > 100000) {
        // a contract upload outlives free RPC request timeouts: broadcast, then poll the hash to FINAL
        await rpc(rpcUrl, "send_tx", { signed_tx_base64: b64, wait_until: "NONE" });
        for (let i = 0; i < 40 && !outcome; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const o = await rpc(rpcUrl, "tx", { tx_hash: txHash, sender_account_id: signerId, wait_until: "FINAL" }).catch(() => null);
          if (o?.final_execution_status === "FINAL") outcome = o;
        }
        if (!outcome) throw Error("tx " + txHash + " not final after 120 s");
      } else outcome = await rpc(rpcUrl, "send_tx", { signed_tx_base64: b64, wait_until: "FINAL" });
    } catch (e) {
      lastErr = e;
      try { outcome = await rpc(rpcUrl, "tx", { tx_hash: txHash, sender_account_id: signerId, wait_until: "FINAL" }); } catch (e2) { lastErr = e2; }
    }
    if (!outcome) await new Promise((res) => setTimeout(res, 3000));
  }
  if (!outcome) throw lastErr;
  return { hash: txHash, outcome };
}

export const callFunction = ({ method, args, gas = 30_000_000_000_000n, deposit = 0n, ...rest }) => sendActions({ ...rest, actions: [functionCallAction(method, args, gas, deposit)] });

/* A fresh ed25519 key pair as near-cli writes it: secret is "ed25519:<base58 seed+public>". */
export async function newKeyPair() {
  const k = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign"]);
  const seed = new Uint8Array(await crypto.subtle.exportKey("pkcs8", k.privateKey)).slice(-32);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
  return { publicKey, publicKeyStr: "ed25519:" + b58encode(publicKey), secretKey: "ed25519:" + b58encode(cat(seed, publicKey)) };
}

export const deployContractAction = (wasm) => cat(Uint8Array.of(0), u32(wasm.length), wasm);
export const transferAction = (deposit) => cat(Uint8Array.of(3), u128(deposit));
export const createAccountAction = () => Uint8Array.of(0);
export const addFullAccessKeyAction = (publicKey) => cat(Uint8Array.of(5), pk(publicKey), u64(0), Uint8Array.of(1));
