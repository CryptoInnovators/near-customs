const rpcs = ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"];
const explorerApi = "https://api-testnet.nearblocks.io/v3";

export async function viewFunction(token, method, args = {}) {
  let failure;
  for (const endpoint of [...rpcs, ...rpcs]) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: "customs-radar", method: "query",
          params: {
            request_type: "call_function", finality: "final", account_id: token,
            method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
          },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`Testnet RPC HTTP ${response.status}`);
      if (!response.ok) throw new Error(`Testnet RPC HTTP ${response.status}`);
      const result = await response.json();
      if (result.error || !result.result?.result) throw new Error("Testnet contract view failed");
      return JSON.parse(Buffer.from(result.result.result).toString());
    } catch (error) {
      failure = error;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  }
  throw failure;
}

export async function transaction(hash) {
  const response = await fetch(`${explorerApi}/txns/${encodeURIComponent(hash)}`);
  if (!response.ok) throw new Error(`Testnet transaction lookup HTTP ${response.status}`);
  const result = await response.json();
  if (result.errors?.length || !result.data) throw new Error("Testnet transaction is unavailable");
  return result.data;
}
