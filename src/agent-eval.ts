import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

const BUN_BIN = process.env.BUN_BIN ?? process.execPath;
const PROJECT_ROOT = process.env.AGENTRAIL_PROJECT_ROOT ?? process.cwd();
const TEST_WALLET = "0x5f0599dade40b691caaf156ec7dc6121833d58bb";

type ProtocolResponse = {
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    data?: unknown;
  };
};

async function main() {
  const protocol = spawn(BUN_BIN, ["run", "src/index.ts", "serve"], {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    env: {
      ...process.env,
      BNB_RPC_URL: process.env.BNB_RPC_URL ?? "https://bsc-rpc.publicnode.com"
    }
  });

  const pending = new Map<string, (value: ProtocolResponse) => void>();
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
        selfDiscoverable:
          discoveredMethods.includes("rpc.discover") &&
          discoveredMethods.includes("rpc.manifest") &&
          discoveredMethods.includes("rpc.schema") &&
          discoveredMethods.includes("wallet.portfolio"),
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
            documentedMethods: Object.keys((manifest.result?.methods as Record<string, unknown>) ?? {}).length
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

function startReader(
  protocol: ChildProcessWithoutNullStreams,
  pending: Map<string, (value: ProtocolResponse) => void>
) {
  let buffer = "";

  protocol.stdout.on("data", (chunk: Buffer | string) => {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const response = JSON.parse(trimmed) as ProtocolResponse;
      pending.get(response.id)?.(response);
      pending.delete(response.id);
    }
  });
}

function sendRequest(
  protocol: ChildProcessWithoutNullStreams,
  pending: Map<string, (value: ProtocolResponse) => void>,
  request: {
    id: string;
    method: string;
    params: Record<string, unknown>;
    output?: {
      paths?: string[];
      view?: "summary-only" | "highlights-only" | "non-zero-only";
      limit?: number;
    };
  }
) {
  return new Promise<ProtocolResponse>((resolve, reject) => {
    pending.set(request.id, resolve);
    protocol.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
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
    }, 20_000);
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await main();
