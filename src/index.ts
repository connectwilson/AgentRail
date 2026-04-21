import { asError, getErrorAdvice } from "./errors";
import { getLlmManifest, getMethodSchema } from "./manifest";
import { methodHandlers } from "./methods";
import type { RequestEnvelope, ResponseEnvelope } from "./types";
import { bigintReplacer } from "./utils";
import { createInterface } from "node:readline";
import { createHttpServer } from "./http-server";
import { PROTOCOL_NAME, PROTOCOL_SCHEMA_VERSION, PROTOCOL_VERSION, withProtocolMeta } from "./protocol";
import { getRpcTransportConfig } from "./config";

const METHOD_ALIASES: Record<string, string> = {
  registry: "registry.lookup",
  lookup: "registry.lookup",
  registryAdd: "registry.add",
  tokenBalance: "token.balance",
  hlAccount: "hyperliquid.account",
  hlBalances: "hyperliquid.balances",
  hlOrders: "hyperliquid.orders",
  hlTrades: "hyperliquid.trades",
  hlLedger: "hyperliquid.ledger",
  hlPlaceOrder: "hyperliquid.placeOrder",
  hlCancelOrder: "hyperliquid.cancelOrder",
  hlModifyOrder: "hyperliquid.modifyOrder",
  hlSignAction: "hyperliquid.signAction",
  hlSendSignedAction: "hyperliquid.sendSignedAction",
  positions: "aave.positions",
  aavePositions: "aave.positions",
  compoundPositions: "compound.positions",
  quote: "uniswap.quote",
  uniswapQuote: "uniswap.quote",
  uniswapPositions: "uniswap.positions",
  lpPositions: "uniswap.positions",
  portfolio: "wallet.portfolio",
  walletPortfolio: "wallet.portfolio",
  plan: "action.plan",
  inspect: "contract.inspect",
  functions: "contract.functions",
  describe: "contract.describe",
  read: "contract.read",
  batch: "batch.read",
  batchRead: "batch.read",
  simulate: "contract.simulate",
  build: "tx.build",
  send: "tx.send",
  decode: "receipt.decode",
  decodeReceipt: "receipt.decode"
};

function printUsage() {
  console.error("Usage: agentrail call <method> --json '<payload>'");
  console.error("   or: agentrail schema <method>");
  console.error("   or: agentrail --llms");
  console.error("   or: agentrail serve");
  console.error("   or: agentrail http [--port 4000]");
  console.error("   alias: acp");
}

function parseArgs(argv: string[]) {
  const [, , command, method, ...rest] = argv;
  if (command !== "call" || !method) {
    throw new Error("Invalid command");
  }

  const jsonFlagIndex = rest.findIndex((item) => item === "--json");
  if (jsonFlagIndex === -1 || !rest[jsonFlagIndex + 1]) {
    throw new Error("Missing --json payload");
  }

  return {
    method,
    payload: JSON.parse(rest[jsonFlagIndex + 1]) as Record<string, unknown>
  };
}

async function main() {
  const command = process.argv[2];
  if (command === "--llms") {
    console.log(JSON.stringify(getLlmManifest(), null, 2));
    return;
  }
  if (command === "schema") {
    const method = process.argv[3];
    if (!method) {
      throw new Error("schema requires a method name.");
    }
    console.log(JSON.stringify({
      method,
      aliasResolvedMethod: METHOD_ALIASES[method] ?? method,
      schema: getMethodSchema(METHOD_ALIASES[method] ?? method)
    }, null, 2));
    return;
  }
  if (command === "serve") {
    await serve();
    return;
  }
  if (command === "http") {
    const portFlag = process.argv.indexOf("--port");
    const portEnv = process.env["AGENTRAIL_HTTP_PORT"];
    const port =
      portFlag !== -1 && process.argv[portFlag + 1]
        ? parseInt(process.argv[portFlag + 1]!, 10)
        : portEnv
          ? parseInt(portEnv, 10)
          : 4000;
    createHttpServer(port);
    // Keep process alive
    await new Promise(() => {});
    return;
  }

  try {
    const { method, payload } = parseArgs(process.argv);
    currentRequestOutputPaths = undefined;
    currentRequestOutputView = undefined;
    currentRequestOutputLimit = undefined;
    const response = await executeRequest({
      id: crypto.randomUUID(),
      method,
      params: payload
    });
    console.log(JSON.stringify(filterResponse(response), bigintReplacer, 2));
  } catch (error) {
    const response = buildErrorResponse(crypto.randomUUID(), error);
    console.log(JSON.stringify(filterResponse(response), bigintReplacer, 2));
    process.exitCode = 1;
  }
}

async function executeRequest(request: RequestEnvelope): Promise<ResponseEnvelope> {
  currentRequestOutputPaths = request.output?.paths;
  currentRequestOutputView = request.output?.view;
  currentRequestOutputLimit = request.output?.limit;
  if (request.method === "rpc.manifest") {
    return withProtocolMeta({
      id: request.id ?? crypto.randomUUID(),
      ok: true,
      result: getLlmManifest(),
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  }
  if (request.method === "rpc.schema") {
    const method =
      request.params && typeof (request.params as Record<string, unknown>).method === "string"
        ? ((request.params as Record<string, unknown>).method as string)
        : undefined;
    if (!method) {
      throw new Error("rpc.schema requires params.method.");
    }
    return withProtocolMeta({
      id: request.id ?? crypto.randomUUID(),
      ok: true,
      result: {
        method,
        aliasResolvedMethod: METHOD_ALIASES[method] ?? method,
        schema: getMethodSchema(METHOD_ALIASES[method] ?? method)
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  }
  if (request.method === "rpc.discover") {
    return withProtocolMeta({
      id: request.id ?? crypto.randomUUID(),
      ok: true,
      result: {
        name: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        transport: "stdio-jsonl",
        methods: ["rpc.discover", "rpc.manifest", "rpc.schema", ...Object.keys(methodHandlers)],
        aliases: METHOD_ALIASES,
        capabilities: {
          abiResolution: ["user-supplied", "abi-path", "sourcify", "explorer", "built-in-standards"],
          chains: ["local", "bnb", "ethereum", "base", "arbitrum", "optimism", "polygon"],
          adapters: ["hyperliquid"],
          outputViews: ["summary-only", "highlights-only", "non-zero-only"],
          execution: {
            batchRead: ["multicall-when-possible", "single-read-fallback"]
          },
          rpc: {
            fallback: true,
            timeoutMs: getRpcTransportConfig().timeout,
            retryCount: getRpcTransportConfig().retryCount,
            retryDelayMs: getRpcTransportConfig().retryDelay
          }
        },
        requestHints: {
          minimalFunctionCall: {
            note: "For many calls you can omit abi and pass function plus returns/stateMutability.",
            example: {
              method: "read",
              params: {
                chain: "bnb",
                address: "0xYourContract",
                function: "balanceOf(address)",
                args: ["0xYourWallet"],
                returns: ["uint256"]
              }
            }
          },
          txSimulation: {
            example: {
              method: "simulate",
              params: {
                chain: "bnb",
                address: "0xYourContract",
                function: "transfer(address,uint256)",
                args: ["0xRecipient", "1000000000000000000"],
                caller: "0xYourWallet",
                stateMutability: "nonpayable",
                policy: { allowWrites: true, simulationRequired: true }
              }
            }
          },
          batchRead: {
            example: {
              method: "batch",
              params: {
                items: [
                  {
                    chain: "bnb",
                    address: "0xTokenA",
                    function: "balanceOf(address)",
                    args: ["0xYourWallet"],
                    returns: ["uint256"],
                    decimals: 18
                  },
                  {
                    chain: "bnb",
                    address: "0xTokenB",
                    function: "balanceOf(address)",
                    args: ["0xYourWallet"],
                    returns: ["uint256"],
                    decimals: 6
                  }
                ]
              }
            }
          },
          protocolShortcuts: {
            examples: [
              {
                method: "hlAccount",
                params: { user: "0xHyperliquidUser" }
              },
              {
                method: "hlTrades",
                params: { user: "0xHyperliquidUser", limit: 20 }
              },
              {
                method: "lookup",
                params: { chain: "bnb", protocol: "aave", symbol: "WBNB" }
              },
              {
                method: "tokenBalance",
                params: { chain: "bnb", token: "0xToken", owner: "0xWallet" }
              },
              {
                method: "positions",
                params: { chain: "bnb", owner: "0xWallet" }
              },
              {
                method: "uniswapPositions",
                params: { chain: "ethereum", owner: "0xWallet" }
              },
              {
                method: "portfolio",
                params: { chain: "ethereum", owner: "0xWallet" }
              },
              {
                method: "plan",
                params: { chain: "bnb", goal: "read aave supply positions", owner: "0xWallet" }
              }
            ]
          }
        }
      },
      meta: {
        timestamp: new Date().toISOString()
      }
    });
  }

  const resolvedMethod = METHOD_ALIASES[request.method] ?? request.method;
  const handler = methodHandlers[resolvedMethod as keyof typeof methodHandlers];
  if (!handler) {
    throw new Error(`Unsupported method: ${request.method}`);
  }

  const response = (await handler(request.params as never)) as ResponseEnvelope;
  response.id = request.id ?? crypto.randomUUID();
  return withProtocolMeta(response);
}

function buildErrorResponse(id: string, error: unknown): ResponseEnvelope {
  const normalized = asError(error);
  return withProtocolMeta({
    id,
    ok: false,
    error: {
      code: normalized.code,
      message: normalized.message,
      data: normalized.data,
      advice: getErrorAdvice(normalized)
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  });
}

async function serve() {
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let requestId: string = crypto.randomUUID();
    try {
      const request = JSON.parse(trimmed) as RequestEnvelope;
      requestId = request.id ?? requestId;
      if (!request.method || typeof request.method !== "string") {
        throw new Error("Request must include a string method.");
      }
      const response = await executeRequest({
        id: requestId,
        method: request.method,
        params: request.params ?? {},
        output: request.output
      });
      process.stdout.write(`${JSON.stringify(filterResponse(response), bigintReplacer)}\n`);
    } catch (error) {
      const response = buildErrorResponse(requestId, error);
      process.stdout.write(`${JSON.stringify(filterResponse(response), bigintReplacer)}\n`);
    }
  }
}

function filterResponse(response: ResponseEnvelope) {
  const viewed = applyOutputView(response, currentRequestOutputView, currentRequestOutputLimit);
  const cliFilter = process.argv.includes("--filter-output")
    ? process.argv[process.argv.indexOf("--filter-output") + 1]
    : undefined;
  const requestFilter = currentRequestOutputPaths;
  const paths = requestFilter ?? (cliFilter
    ? cliFilter.split(",").map((path) => path.trim()).filter(Boolean)
    : undefined);
  if (!paths || paths.length === 0) {
    return viewed;
  }
  const filtered: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getPathValue(viewed, path);
    if (value !== undefined) {
      filtered[path] = value;
    }
  }
  return {
    id: viewed.id,
    ok: viewed.ok,
    result: filtered,
    error: viewed.error,
    meta: viewed.meta
  };
}

function applyOutputView(
  response: ResponseEnvelope,
  view?: "summary-only" | "highlights-only" | "non-zero-only",
  limit?: number
) {
  if (!view) {
    return response;
  }

  const result = typeof response.result === "object" && response.result ? { ...response.result } : {};

  if (view === "summary-only") {
    return {
      ...response,
      result: {
        summary: getPathValue(response, "result.summary") ?? null
      }
    };
  }

  if (view === "highlights-only") {
    const highlights = getPathValue(response, "result.highlights");
    const sliced = Array.isArray(highlights) && typeof limit === "number"
      ? highlights.slice(0, limit)
      : highlights;
    return {
      ...response,
      result: {
        summary: getPathValue(response, "result.summary") ?? null,
        highlights: sliced ?? []
      }
    };
  }

  if (view === "non-zero-only") {
    const positions = getPathValue(response, "result.nonZeroPositions");
    const sliced = Array.isArray(positions) && typeof limit === "number"
      ? positions.slice(0, limit)
      : positions;
    return {
      ...response,
      result: {
        summary: getPathValue(response, "result.summary") ?? null,
        nonZeroPositions: sliced ?? []
      }
    };
  }

  return {
    ...response,
    result
  };
}

let currentRequestOutputPaths: string[] | undefined;
let currentRequestOutputView: "summary-only" | "highlights-only" | "non-zero-only" | undefined;
let currentRequestOutputLimit: number | undefined;

function getPathValue(source: unknown, path: string) {
  const segments = path.split(".").filter(Boolean);
  let current = source as Record<string, unknown> | undefined;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = current[segment] as Record<string, unknown>;
  }
  return current;
}

if (import.meta.main) {
  if (!["serve", "--llms", "schema", "http"].includes(process.argv[2] ?? "") && process.argv.length < 5) {
    printUsage();
    process.exit(1);
  }
  await main();
}
