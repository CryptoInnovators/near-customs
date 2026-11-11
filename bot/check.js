import { transaction, viewFunction } from "./near.js";

const filingTransactions = [
  "3Nr9SzTP8jBpZxTwV9W9hPfd2KMjfSsYqPBGyru3RuVN",
  "FVbjGgwXwyGAVkqR8JMLXKLyvRuGgZ65QLTBp2vJ1ECq",
];
const explorer = "https://testnet.nearblocks.io/txns/";

function verdict(state) {
  if (state && typeof state === "object" && "Upheld" in state) return "Upheld";
  if (typeof state === "string") return state;
  return "Pending";
}

export async function checkTestnetToken(token) {
  const params = await viewFunction(token, "customs_params");
  const lines = [`${token}: Customs judge ${params.outlayer_id}; vest ${params.vest_s}s; seizure ${params.seize_bps} bps.`];
  for (let id = 0; id < 64; id += 1) {
    const challenge = await viewFunction(token, "challenge_of", { challenge_id: id });
    if (!challenge) break;
    const hash = filingTransactions[id];
    const tx = hash && await transaction(hash);
    const action = tx?.actions?.find((item) => item.args?.method_name === "challenge");
    if (hash && (tx.transaction_hash !== hash || tx.receiver_account_id !== token || tx.outcomes?.status !== true ||
      action?.args?.args_json?.wallet !== challenge.wallet ||
      JSON.stringify(action?.args?.args_json?.path) !== JSON.stringify(challenge.path))) {
      throw new Error(`Challenge ${id} does not match its testnet filing transaction`);
    }
    const path = (challenge.path || []).map((item) => `https://testnet.nearblocks.io/txns/${encodeURIComponent(item)}`).join(", ");
    const filed = hash ? `Filing: ${explorer}${hash}` : "Filing transaction unavailable.";
    lines.push(`#${id} ${verdict(challenge.state)}: ${challenge.wallet}; ${filed}; funding path: ${path || "none"}.`);
  }
  return lines.join("\n");
}
