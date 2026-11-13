// Cold headline run through the real page in a tab of the running Chromium (CDP): load the URL, read the stamp, press a button,
// poll the page until the contract's terminal answer is on screen, report seconds and console errors.
// node scripts/cold-run.mjs <url> <button selector: #break-go | #break-clean | #bare-go> <out.png> [payout account]
const [url, button, out, payout] = process.argv.slice(2);
const CDP = process.env.CUSTOMS_CDP || "http://127.0.0.1:9396";
const version = await (await fetch(CDP + "/json/version")).json();
const browser = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => browser.addEventListener("open", r));
let n = 0; const waiting = new Map();
browser.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (ws, method, params = {}, sessionId) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const { result: { targetId } } = await send(browser, "Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send(browser, "Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => send(browser, m, p, sessionId);
const errors = [];
browser.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.sessionId !== sessionId) return;
  if (m.method === "Runtime.exceptionThrown") errors.push("exception: " + m.params.exceptionDetails.text + " " + (m.params.exceptionDetails.exception?.description || "").slice(0, 120));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push("console: " + m.params.entry.text + " " + (m.params.entry.url || ""));
  if (m.method === "Network.loadingFailed" && !m.params.canceled) errors.push("request failed: " + m.params.errorText);
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && m.params.response.url.startsWith(new URL(url).origin)) errors.push("HTTP " + m.params.response.status + " " + m.params.response.url);
});
const ev = async (expr) => (await s("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
for (const d of ["Runtime", "Log", "Network", "Page"]) await s(d + ".enable");
await s("Network.setCacheDisabled", { cacheDisabled: true });
await s("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const t0 = Date.now();
await s("Page.navigate", { url });
for (let i = 0; i < 60; i++) { if (await ev(`document.querySelector("#seal-state")?.textContent`) && !/the contract|not readable/.test(await ev(`document.querySelector("#seal-state").textContent`))) break; await new Promise((r) => setTimeout(r, 500)); }
console.log("stamp on load:", await ev(`document.querySelector("#seal-amount").textContent + " " + document.querySelector("#seal-state").textContent`));
if (payout) await ev(`(() => { const i = document.querySelector("#payout"); i.value = ${JSON.stringify(payout)}; i.dispatchEvent(new Event("input")); })()`);
const t1 = Date.now();
await ev(`document.querySelector(${JSON.stringify(button)}).click()`);
let text = "";
for (let i = 0; i < 400; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  text = await ev(`document.querySelector("#stage-steps").innerText`);
  if (/Upheld\.|Rejected\.|Refused|No verdict yet|could not|did not complete|free again|Try again/.test(text)) break;
}
const secs = ((Date.now() - t1) / 1000).toFixed(0);
await ev(`document.querySelector("#stage-steps").scrollIntoView({block:"center"})`);
const shot = await s("Page.captureScreenshot", { format: "png" });
await (await import("node:fs/promises")).writeFile(out, Buffer.from(shot.result.data, "base64"));
const links = await ev(`[...document.querySelectorAll("#stage-steps a")].map((a) => a.href)`);
console.log(`seconds from click to terminal: ${secs}; from page load to terminal: ${((Date.now() - t0) / 1000).toFixed(0)}`);
console.log(text); console.log("links:", links.join(" "));
console.log("console/network errors:", errors.length, errors.slice(0, 5));
await send(browser, "Target.closeTarget", { targetId });
process.exit(0);
