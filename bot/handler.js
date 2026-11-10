import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const launchApi = "https://nearly.trade/api";
const rpc = "https://rpc.mainnet.fastnear.com";
const explorer = "https://nearblocks.io/txns/";

async function replay(token, creator) {
  const { stdout } = await execFileAsync("cargo", [
    "run", "--release", "-p", "customs-walker", "--", "replay",
    "--token", token, "--creator", creator,
  ], { cwd: new URL("..", import.meta.url), maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}

async function view(token, method, args = {}) {
  const body = { jsonrpc: "2.0", id: "customs-radar", method: "query", params: {
    request_type: "call_function", finality: "final", account_id: token,
    method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  } };
  const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
  const data = await response.json();
  if (data.error || data.result?.error) throw new Error("Contract view failed");
  return JSON.parse(Buffer.from(data.result.result).toString());
}

async function challengeStatus(token) {
  try {
    await view(token, "customs_params");
  } catch {
    return "Live challenge status: this token does not expose a Customs challenge contract.";
  }
  const entries = [];
  for (let id = 0; id < 64; id += 1) {
    const challenge = await view(token, "challenge_of", { challenge_id: id });
    if (!challenge) break;
    const state = challenge.state;
    const label = state && typeof state === "object" && state.Upheld ? "Upheld" : String(state);
    entries.push(`#${id} ${label}`);
  }
  return entries.length
    ? `Live challenge status: ${entries.join(", ")}.`
    : "Live challenge status: no challenges have been filed.";
}

export function createHandler({ fetchImpl = fetch, replayFn = replay, challengeFn = challengeStatus } = {}) {
  return async function handle(text) {
    const [command, ...args] = String(text || "").trim().split(/\s+/);
    if (command === "/start" || command?.startsWith("/start@")) {
      return "Customs Radar traces whether a token's opening buyers received funds from its creator, using NEAR transaction receipts. Use /check <token.near> for a funding-path verdict and live challenge status.";
    }
    if (command !== "/check" && !command?.startsWith("/check@")) return "Use /check <token.near> to inspect a launch.";
    const token = args[0];
    if (!token || !/^[a-z0-9][a-z0-9._-]{1,63}\.near$/.test(token)) return "Usage: /check <token.near>";

    let launch;
    try {
      const response = await fetchImpl(`${launchApi}/launch/${encodeURIComponent(token)}`);
      if (!response.ok) return `Could not load ${token} from Nearly (HTTP ${response.status}).`;
      launch = await response.json();
    } catch {
      return "Could not reach Nearly launch data. Try again shortly.";
    }
    if (!launch.creator) return `No creator account is available for ${token}, so its funding paths cannot be checked.`;

    let report;
    try {
      report = await replayFn(token, launch.creator);
    } catch {
      return `Funding-path check failed for ${token}. Chain data may be unavailable; try again shortly.`;
    }
    const rows = report.rows || [];
    const linked = rows.filter((row) => row.class === "linked" || row.class === "creator");
    const receipt = linked.flatMap((row) => row.path || []).find((edge) => edge.tx)?.tx || linked.find((row) => row.first_buy_tx)?.first_buy_tx;
    let status;
    try { status = await challengeFn(token); }
    catch { status = "Live challenge status could not be read from NEAR."; }
    const verdict = `${linked.length} of ${report.buyers} opening buyers trace to creator ${launch.creator}.`;
    const receiptLine = receipt ? `\nReceipt: ${explorer}${encodeURIComponent(receipt)}` : "\nReceipt: no creator-linked funding receipt found.";
    return `${token}\nFunding-path verdict: ${verdict}${receiptLine}\n${status}`;
  };
}
