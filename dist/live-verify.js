// src/live-verify.ts
import { spawn } from "node:child_process";
var BUN_BIN = process.env.BUN_BIN ?? process.execPath;
var PROJECT_ROOT = process.env.AGENTRAIL_PROJECT_ROOT ?? process.cwd();
var WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
var ERC20_METADATA_ABI = [
  {
    type: "function",
    stateMutability: "view",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }]
  },
  {
    type: "function",
    stateMutability: "view",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }]
  }
];
async function main() {
  const protocol = spawn(BUN_BIN, ["run", "src/index.ts", "serve"], {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      ETHEREUM_RPC_URL: process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
    }
  });
  const pending = new Map;
  startReader(protocol, pending);
  try {
    const discover = await sendRequest(protocol, pending, {
      id: "discover-live",
      method: "rpc.discover",
      params: {}
    });
    assert(discover.ok, `rpc.discover failed: ${discover.error?.message ?? "unknown error"}`);
    const inspect = await sendRequest(protocol, pending, {
      id: "inspect-live",
      method: "contract.inspect",
      params: {
        chain: "ethereum",
        address: WETH_ADDRESS
      }
    });
    assert(inspect.ok, `contract.inspect failed: ${inspect.error?.message ?? "unknown error"}`);
    assert(inspect.result?.isContract === true, `Expected WETH address to be a contract, got ${String(inspect.result?.isContract)}`);
    const symbol = await sendRequest(protocol, pending, {
      id: "read-symbol-live",
      method: "contract.read",
      params: {
        chain: "ethereum",
        address: WETH_ADDRESS,
        abi: ERC20_METADATA_ABI,
        function: "symbol()",
        args: []
      }
    });
    assert(symbol.ok, `symbol read failed: ${symbol.error?.message ?? "unknown error"}`);
    assert(symbol.result?.decoded === "WETH", `Expected symbol WETH, got ${String(symbol.result?.decoded)}`);
    const decimals = await sendRequest(protocol, pending, {
      id: "read-decimals-live",
      method: "contract.read",
      params: {
        chain: "ethereum",
        address: WETH_ADDRESS,
        abi: ERC20_METADATA_ABI,
        function: "decimals()",
        args: []
      }
    });
    assert(decimals.ok, `decimals read failed: ${decimals.error?.message ?? "unknown error"}`);
    assert(decimals.result?.decoded === "18", `Expected decimals 18, got ${String(decimals.result?.decoded)}`);
    console.log(JSON.stringify({
      ok: true,
      verifiedContract: WETH_ADDRESS,
      checks: {
        rpcDiscover: true,
        inspect: inspect.result,
        symbol: symbol.result?.decoded,
        decimals: decimals.result?.decoded
      }
    }, null, 2));
  } finally {
    protocol.kill();
  }
}
function startReader(protocol, pending) {
  let buffer = "";
  protocol.stdout.on("data", (chunk) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = buffer.split(`
`);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const response = JSON.parse(trimmed);
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    }
  });
}
function sendRequest(protocol, pending, request) {
  return new Promise((resolve, reject) => {
    pending.set(request.id, resolve);
    protocol.stdin.write(`${JSON.stringify(request)}
`, (error) => {
      if (error) {
        pending.delete(request.id);
        reject(error);
      }
    });
    setTimeout(() => {
      if (pending.has(request.id)) {
        pending.delete(request.id);
        reject(new Error(`Timed out waiting for protocol response: ${request.id}`));
      }
    }, 15000);
  });
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
await main();
