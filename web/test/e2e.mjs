/* Browser e2e: drives the real pages against NEAR testnet and mainnet in a tab of an already running
   Chromium (CDP, default http://127.0.0.1:9396, override with CUSTOMS_CDP). Serves web/ from a local static server,
   opens its own tab, never a new profile, and closes the tab at the end.
   node web/test/e2e.mjs [outDir]   screenshots land in outDir (default .progress/screens/round1) */

import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = process.argv[2] || fileURLToPath(new URL("../../.progress/screens/round1", import.meta.url));
const CDP = process.env.CUSTOMS_CDP || "http://127.0.0.1:9396";
const ONLY = process.env.CUSTOMS_E2E_ONLY ? process.env.CUSTOMS_E2E_ONLY.split(",") : null;
const SCALE = Number(process.env.CUSTOMS_E2E_SCALE || 1);
const COIN = "customs26-token.testnet";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain" };

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  " + JSON.stringify(detail)));
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
      try {
        const body = await readFile(join(ROOT, path.endsWith("/") ? path + "index.html" : path));
        res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, () => resolve(server));
  });
}

class Tab {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) this.handlers.forEach((h) => h(msg));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(h) { this.handlers.push(h); }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page eval: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expression, ms, what) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      try { last = await this.eval(expression); if (last) return last; } catch (e) { last = e.message; }
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error("timed out after " + ms + " ms waiting for " + what + " (last: " + JSON.stringify(last) + ")");
  }
}

async function openTab() {
  const version = await (await fetch(CDP + "/json/version")).json();
  const browser = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { browser.addEventListener("open", resolve); browser.addEventListener("error", () => reject(new Error("Browser CDP websocket failed at " + CDP))); });
  let sequence = 0;
  const browserSend = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const receive = (event) => { const msg = JSON.parse(event.data); if (msg.id !== id) return; browser.removeEventListener("message", receive); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); };
    browser.addEventListener("message", receive);
    browser.send(JSON.stringify({ id, method, params }));
  });
  const { targetId } = await browserSend("Target.createTarget", { url: "about:blank", background: true });
  const target = { id: targetId, webSocketDebuggerUrl: CDP.replace(/^http/, "ws") + "/devtools/page/" + targetId };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", () => reject(new Error("CDP websocket failed at " + CDP))); });
  return { tab: new Tab(ws), targetId, browser, browserSend };
}

const FACTS = `(() => {
  const q = (s) => document.querySelector(s);
  const all = (s) => [...document.querySelectorAll(s)];
  const rect = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), width: Math.round(r.width) }; };
  return {
    title: document.title,
    h1: q("h1") ? q("h1").textContent.trim() : null,
    h1Font: q("h1") ? getComputedStyle(q("h1")).fontFamily : null,
    bodyFont: getComputedStyle(document.body).fontFamily,
    viewport: innerWidth,
    loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")),
    overflow: document.documentElement.scrollWidth - innerWidth,
    launchRows: all("#launch-rows tr[data-token]").length,
    pinned: q('#launch-rows tr[data-token="customs26-token.testnet"]') !== null,
    funded: q("#funded-count")?.textContent.trim() || null,
    buyers: all("#buy-tape .ledger-row").length,
    tapeState: q("#tape-meta")?.textContent.trim() || null,
    contractChecks: q("#checks-count")?.textContent.trim() || null,
    challengeText: q("#challenge-content")?.innerText || "",
    challengeButtons: all(".row-challenge").length,
    scenarios: all("#scenarios .lab-case").length,
    visibleText: document.body.innerText,
    pageError: q("#page-error") && !q("#page-error").hidden ? q("#page-error").textContent : null,
    navHrefs: all("nav a").map((a) => a.getAttribute("href")),
    badDash: /[—–]/.test(document.body.innerText),
    badFonts: (() => { const bad = new Set(); const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim() || !n.parentElement) continue; const cs = getComputedStyle(n.parentElement); if (cs.display === "none" || cs.visibility === "hidden") continue; const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(); if (fam !== "Schibsted" && fam !== "IBM Plex Mono") bad.add(fam + " in <" + n.parentElement.tagName.toLowerCase() + "> " + n.textContent.trim().slice(0, 30)); } return [...bad].slice(0, 5); })(),
    shadows: all("*").filter((e) => getComputedStyle(e).boxShadow !== "none" || getComputedStyle(e).textShadow !== "none").length,
    gradients: all("*").filter((e) => /gradient/.test(getComputedStyle(e).backgroundImage)).length,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    text: document.body.innerText.length,
    docH: document.documentElement.scrollHeight,
    contentBottom: Math.round(document.querySelector(".close") ? document.querySelector(".close").getBoundingClientRect().bottom + scrollY : 0),
    lowest: all("body *").map((e) => ({ t: e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""), b: Math.round(e.getBoundingClientRect().bottom + scrollY) })).sort((a, b) => b.b - a.b).slice(0, 3),
  };
})()`;

async function visit(tab, errors, name, url, width, height, ready, readyMs, assert) {
  if (ONLY && !ONLY.includes(name)) return null;
  errors.length = 0;
  const mobile = width < 500;
  await tab.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await tab.send("Page.navigate", { url });
  await tab.waitFor("document.readyState !== 'loading' && location.href.startsWith('http')", 20000, name + " document");
  const dpr = await tab.eval("devicePixelRatio");
  check(name + " @" + width + ": rendered at 1:1 (no page zoom on this host)", Math.abs(dpr - 1) < 0.001 || mobile, dpr);
  let facts;
  try {
    await tab.waitFor(ready, readyMs * SCALE, name + " ready");
    await new Promise((r) => setTimeout(r, 1500));
    facts = await tab.eval(FACTS);
  } catch (e) {
    check(name + ": page reached its settled state", false, e.message);
    facts = await tab.eval(FACTS).catch(() => ({}));
  }
  const tag = name + " @" + width;
  /* FastNEAR answers 429 (with or without CORS headers) when ten lanes share one IP; the page retries and recovers.
     Those lines are counted and reported, every other console error (own code, own assets, exceptions) fails. */
  const throttled = errors.filter((e) => /fastnear\.com|near\.org/.test(e) && /CORS|429|ERR_FAILED|Failed to load resource/.test(e));
  const own = errors.filter((e) => !throttled.includes(e));
  check(tag + ": zero console errors from the page's own code and assets", own.length === 0, own.slice(0, 5));
  console.log("INFO " + tag + ": " + throttled.length + " throttled public-endpoint requests absorbed by retry");
  check(tag + ": no horizontal overflow", facts.overflow !== undefined && facts.overflow <= 0, facts.overflow);
  check(tag + ": Schibsted and IBM Plex Mono are loaded", (facts.loaded || []).includes("Schibsted") && (facts.loaded || []).includes("IBM Plex Mono"), facts.loaded);
  check(tag + ": headings use Schibsted", !facts.h1 || /Schibsted/.test(facts.h1Font || ""), facts.h1Font);
  check(tag + ": every visible text node uses the project fonts", (facts.badFonts || ["no facts"]).length === 0, facts.badFonts);
  check(tag + ": no em dash or en dash in visible copy", !facts.badDash, facts.visibleText);
  check(tag + ": no shadows, no gradients, near-black canvas", facts.shadows === 0 && facts.gradients === 0 && facts.bodyBg === "rgb(10, 10, 11)", [facts.shadows, facts.gradients, facts.bodyBg]);
  assert(tag, facts, { width, height });
  if (process.env.CUSTOMS_E2E_PROBE) console.log("PROBE " + tag + ": " + JSON.stringify(await tab.eval(process.env.CUSTOMS_E2E_PROBE)));
  /* stamps that land when they scroll into view: walk the page once, as a reader does */
  await tab.eval("(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += Math.max(200, innerHeight / 2)) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 600)); })()");
  console.log("INFO " + tag + ": document " + facts.docH + " px, content ends " + facts.contentBottom + " px, lowest " + JSON.stringify(facts.lowest));
  const metrics = await tab.send("Page.getLayoutMetrics");
  const full = Math.ceil(metrics.cssContentSize.height);
  const shot = async (file, clip) => {
    const { data } = await tab.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: Object.assign({ x: 0, y: 0, scale: 1 }, clip) });
    await writeFile(join(OUT, file), Buffer.from(data, "base64"));
  };
  await shot(name + "-" + width + "-fold.png", { width, height });
  await shot(name + "-" + width + "-full.png", { width, height: full });
  if (process.env.CUSTOMS_E2E_SLICES) {
    for (let y = 0, i = 1; y < full; y += height, i++) await shot(name + "-" + width + "-s" + i + ".png", { y, width, height: Math.min(height, full - y) });
  }
  return facts;
}

const hex = (s) => /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(s || "");

function board(tag, f) {
  check(tag + ": live launch rows and the pinned Customs token render", f.launchRows > 1 && f.pinned, [f.launchRows, f.pinned]);
  check(tag + ": board links to token inspections and the method page", (f.navHrefs || []).some((h) => /token\.html/.test(h)) && (f.navHrefs || []).some((h) => /attack-lab\.html/.test(h)), f.navHrefs);
}

function inspection(tag, f, vp) {
  check(tag + ": verdict-first headline and buyer ledger render", /Was .* sniped\?/.test(f.h1 || "") && f.buyers >= 10, [f.h1, f.buyers]);
  check(tag + ": funded count and weighted line resolve", /^\d+$/.test(f.funded || "") && /NEAR in opening buys/.test(f.visibleText), [f.funded, f.visibleText.slice(0, 300)]);
  check(tag + ": token identity and market data render", /phire/i.test(f.visibleText) && /PRICE/.test(f.visibleText), f.visibleText.slice(0, 500));
  check(tag + ": mobile or desktop navigation remains on screen", f.overflow <= 0 && f.viewport === vp.width, [f.overflow, f.viewport, vp.width]);
}

function customs(tag, f) {
  check(tag + ": Customs contract rules and challenge fees are read", f.contractChecks === "4/4" && /0\.50 NEAR/.test(f.challengeText) && /0\.10 NEAR/.test(f.challengeText), [f.contractChecks, f.challengeText]);
  check(tag + ": no challenge action appears without a funded buyer", f.challengeButtons === 0, f.challengeButtons);
}

function method(tag, f) {
  check(tag + ": all three deterministic scenarios render", f.scenarios === 3, f.scenarios);
  check(tag + ": scenarios show linked, unlinked and outside-window outcomes", /Exchange-funded buyer/.test(f.visibleText) && /Creator-funded opening buyers/.test(f.visibleText) && /Transfer after vesting/.test(f.visibleText), f.visibleText.slice(0, 700));
}

await mkdir(OUT, { recursive: true });
const server = await serve();
/* localhost, not 127.0.0.1: the shared browser keeps an 80% page zoom for 127.0.0.1 */
const base = "http://localhost:" + server.address().port;
let targetId, opened;
try {
  opened = await openTab();
  const tab = opened.tab;
  targetId = opened.targetId;
  const errors = [];
  tab.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") errors.push("exception: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    if (msg.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(msg.params.type)) errors.push("console." + msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description).join(" "));
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push("log: " + msg.params.entry.text + " " + (msg.params.entry.url || ""));
  });
  await tab.send("Runtime.enable");
  await tab.send("Log.enable");
  await tab.send("Page.enable");

  const settledBoard = `document.querySelectorAll("#launch-rows tr[data-token]").length > 1`;
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await visit(tab, errors, "board", base + "/index.html", w, h, settledBoard, 60000, board);
  }
  const inspected = `document.querySelector("#tape-meta") && document.querySelector("#tape-meta").textContent !== "Reading the first-sale window…"`;
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    await visit(tab, errors, "inspection", base + "/token.html?t=phire.nearlytrade.near", w, h, inspected, 240000, inspection);
  }
  const contractReady = `document.querySelector("#checks-count")?.textContent === "4/4"`;
  await visit(tab, errors, "customs", base + "/token.html?t=" + COIN, 1440, 900, contractReady, 120000, customs);
  const methodReady = `document.querySelectorAll("#scenarios .lab-case").length === 3`;
  for (const [w, h] of [[1440, 900], [390, 844]]) await visit(tab, errors, "method", base + "/attack-lab.html", w, h, methodReady, 30000, method);
} finally {
  server.close();
  if (targetId && opened) await opened.browserSend("Target.closeTarget", { targetId }).catch(() => {});
  opened?.browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log("\n" + (results.length - failed.length) + " passed, " + failed.length + " failed");
process.exit(failed.length ? 1 : 0);
