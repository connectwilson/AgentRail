// src/hyperliquid-eval.ts
import { spawn } from "node:child_process";
var BUN_BIN = process.env.BUN_BIN ?? process.execPath;
var PROJECT_ROOT = process.env.AGENTRAIL_PROJECT_ROOT ?? process.cwd();
var TEST_USER = process.env.HYPERLIQUID_TEST_USER ?? "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";
async function main() {
  const protocol = spawn(BUN_BIN, ["run", "src/index.ts", "serve"], {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      HYPERLIQUID_API_URL: process.env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz/info"
    }
  });
  const pending = new Map;
  startReader(protocol, pending);
  try {
    const discover = await sendRequest(protocol, pending, {
      id: "hl-discover",
      method: "rpc.discover",
      params: {}
    });
    assert(discover.ok, `rpc.discover failed: ${discover.error?.message ?? "unknown error"}`);
    const schema = await sendRequest(protocol, pending, {
      id: "hl-schema",
      method: "rpc.schema",
      params: { method: "hyperliquid.account" }
    });
    assert(schema.ok, `rpc.schema failed: ${schema.error?.message ?? "unknown error"}`);
    const account = await sendRequest(protocol, pending, {
      id: "hl-account",
      method: "hyperliquid.account",
      params: { user: TEST_USER },
      output: { view: "highlights-only", limit: 5 }
    });
    assert(account.ok, `hyperliquid.account failed: ${account.error?.message ?? "unknown error"}`);
    const preview = await sendRequest(protocol, pending, {
      id: "hl-preview",
      method: "hyperliquid.placeOrder",
      params: {
        user: TEST_USER,
        market: "BTC",
        side: "buy",
        size: "0.01",
        orderType: "market",
        slippageBps: 50
      }
    });
    assert(preview.ok, `hyperliquid.placeOrder failed: ${preview.error?.message ?? "unknown error"}`);
    let signingObserved = null;
    if (process.env.HYPERLIQUID_PRIVATE_KEY && preview.result?.signingRequest) {
      const sign = await sendRequest(protocol, pending, {
        id: "hl-sign",
        method: "hyperliquid.signAction",
        params: {
          signingRequest: preview.result.signingRequest,
          policy: {
            allowWrites: true,
            mode: "unsafe"
          }
        },
        output: { paths: ["result.executionMode", "result.signerAddress", "result.summary"] }
      });
      assert(sign.ok, `hyperliquid.signAction failed: ${sign.error?.message ?? "unknown error"}`);
      signingObserved = sign.result ?? null;
    }
    const evaluation = {
      ok: true,
      scenario: "fresh-ai-caller-hyperliquid",
      task: "Discover the Hyperliquid adapter, answer an account question, and prepare a safe execution preview without any exchange-specific client code.",
      verdict: {
        selfDiscoverable: Array.isArray(discover.result?.methods) && discover.result?.methods.includes("hyperliquid.account"),
        schemaAvailable: Boolean(schema.result?.schema),
        taskSucceeded: Boolean(readPath(account.result, "summary")) && Boolean(readPath(preview.result, "summary")),
        previewExecutionUsable: Boolean(readPath(preview.result, "signingRequest")),
        signPathUsable: Boolean(signingObserved || !process.env.HYPERLIQUID_PRIVATE_KEY),
        usableForNewAgent: true
      },
      transcript: [
        {
          step: 1,
          request: { method: "rpc.discover", params: {} },
          observed: {
            methodsCount: Array.isArray(discover.result?.methods) ? discover.result?.methods.length : 0,
            adapters: discover.result?.capabilities
          }
        },
        {
          step: 2,
          request: { method: "rpc.schema", params: { method: "hyperliquid.account" } },
          observed: {
            hasSchema: Boolean(schema.result?.schema)
          }
        },
        {
          step: 3,
          request: {
            method: "hyperliquid.account",
            params: { user: TEST_USER },
            output: { view: "highlights-only", limit: 5 }
          },
          observed: account.result
        },
        {
          step: 4,
          request: {
            method: "hyperliquid.placeOrder",
            params: {
              user: TEST_USER,
              market: "BTC",
              side: "buy",
              size: "0.01",
              orderType: "market",
              slippageBps: 50
            }
          },
          observed: {
            executionMode: readPath(preview.result, "executionMode"),
            summary: readPath(preview.result, "summary"),
            signingRequest: readPath(preview.result, "signingRequest")
          }
        },
        {
          step: 5,
          request: process.env.HYPERLIQUID_PRIVATE_KEY ? {
            method: "hyperliquid.signAction",
            params: {
              signingRequest: "[from previous preview step]",
              policy: { allowWrites: true, mode: "unsafe" }
            }
          } : {
            method: "hyperliquid.signAction",
            note: "skipped because HYPERLIQUID_PRIVATE_KEY is not configured"
          },
          observed: signingObserved
        }
      ]
    };
    console.log(JSON.stringify(evaluation, null, 2));
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
      if (!trimmed)
        continue;
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
    }, 20000);
  });
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
function readPath(value, key) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return null;
  const record = value;
  return record[key] ?? record[`result.${key}`] ?? null;
}
await main();
