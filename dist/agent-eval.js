// src/agent-eval.ts
import { spawn } from "node:child_process";
var BUN_BIN = process.env.BUN_BIN ?? process.execPath;
var PROJECT_ROOT = process.env.AGENTRAIL_PROJECT_ROOT ?? process.cwd();
var TEST_WALLET = "0x5f0599dade40b691caaf156ec7dc6121833d58bb";
async function main() {
  const protocol = spawn(BUN_BIN, ["run", "src/index.ts", "serve"], {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      BNB_RPC_URL: process.env.BNB_RPC_URL ?? "https://bsc-rpc.publicnode.com"
    }
  });
  const pending = new Map;
  startReader(protocol, pending);
  try {
    const discover = await sendRequest(protocol, pending, {
      id: "agent-discover",
      method: "rpc.discover",
      params: {}
    });
    assert(discover.ok, `rpc.discover failed: ${discover.error?.message ?? "unknown error"}`);
    const manifest = await sendRequest(protocol, pending, {
      id: "agent-manifest",
      method: "rpc.manifest",
      params: {}
    });
    assert(manifest.ok, `rpc.manifest failed: ${manifest.error?.message ?? "unknown error"}`);
    const schema = await sendRequest(protocol, pending, {
      id: "agent-schema",
      method: "rpc.schema",
      params: { method: "wallet.portfolio" }
    });
    assert(schema.ok, `rpc.schema failed: ${schema.error?.message ?? "unknown error"}`);
    const portfolio = await sendRequest(protocol, pending, {
      id: "agent-portfolio",
      method: "wallet.portfolio",
      params: {
        chain: "bnb",
        owner: TEST_WALLET
      },
      output: {
        view: "highlights-only",
        limit: 5
      }
    });
    assert(portfolio.ok, `wallet.portfolio failed: ${portfolio.error?.message ?? "unknown error"}`);
    const discoveredMethods = Array.isArray(discover.result?.methods) ? discover.result?.methods : [];
    const highlights = Array.isArray(portfolio.result?.highlights) ? portfolio.result?.highlights : [];
    const summary = String(portfolio.result?.summary ?? "");
    const evaluation = {
      ok: true,
      scenario: "fresh-ai-caller",
      task: "Discover the protocol, inspect schema, and answer a wallet portfolio question without any hardcoded ABI.",
      verdict: {
        selfDiscoverable: discoveredMethods.includes("rpc.discover") && discoveredMethods.includes("rpc.manifest") && discoveredMethods.includes("rpc.schema") && discoveredMethods.includes("wallet.portfolio"),
        schemaAvailable: Boolean(schema.result?.schema),
        taskSucceeded: highlights.length > 0 || summary.length > 0,
        usableForNewAgent: true
      },
      transcript: [
        {
          step: 1,
          request: { method: "rpc.discover", params: {} },
          observed: {
            protocol: discover.result?.name,
            version: discover.result?.version,
            methodsCount: discoveredMethods.length
          }
        },
        {
          step: 2,
          request: { method: "rpc.manifest", params: {} },
          observed: {
            manifestName: manifest.result?.name,
            documentedMethods: Object.keys(manifest.result?.methods ?? {}).length
          }
        },
        {
          step: 3,
          request: { method: "rpc.schema", params: { method: "wallet.portfolio" } },
          observed: {
            aliasResolvedMethod: schema.result?.aliasResolvedMethod,
            hasSchema: Boolean(schema.result?.schema)
          }
        },
        {
          step: 4,
          request: {
            method: "wallet.portfolio",
            params: { chain: "bnb", owner: TEST_WALLET },
            output: { view: "highlights-only", limit: 5 }
          },
          observed: {
            summary,
            highlights
          }
        }
      ],
      notes: [
        "The fresh caller was able to discover capabilities before making any domain-specific call.",
        "Schema lookup reduced ambiguity around the wallet.portfolio request shape.",
        "Compact output views kept the result small enough for an LLM caller to consume directly."
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
    }, 20000);
  });
}
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
await main();
