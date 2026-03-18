import { spawn, type Subprocess } from "bun";

const BUN_BIN = process.execPath;
const PROJECT_ROOT = "/Users/wilson/Documents/AgentRail";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const ERC20_METADATA_ABI = [
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
  const protocol = spawn({
    cmd: [BUN_BIN, "run", "src/index.ts", "serve"],
    cwd: PROJECT_ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ETHEREUM_RPC_URL: process.env.ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com"
    }
  });

  const pending = new Map<string, (value: ProtocolResponse) => void>();
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
    assert(
      inspect.result?.isContract === true,
      `Expected WETH address to be a contract, got ${String(inspect.result?.isContract)}`
    );

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

    console.log(
      JSON.stringify(
        {
          ok: true,
          verifiedContract: WETH_ADDRESS,
          checks: {
            rpcDiscover: true,
            inspect: inspect.result,
            symbol: symbol.result?.decoded,
            decimals: decimals.result?.decoded
          }
        },
        null,
        2
      )
    );
  } finally {
    protocol.kill();
  }
}

function startReader(
  protocol: Subprocess<"pipe", "pipe", "pipe">,
  pending: Map<string, (value: ProtocolResponse) => void>
) {
  const reader = protocol.stdout.getReader();
  let buffer = "";

  void (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += new TextDecoder().decode(chunk.value);
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
    }
  })();
}

function sendRequest(
  protocol: Subprocess<"pipe", "pipe", "pipe">,
  pending: Map<string, (value: ProtocolResponse) => void>,
  request: {
    id: string;
    method: string;
    params: Record<string, unknown>;
  }
) {
  return new Promise<ProtocolResponse>((resolve, reject) => {
    pending.set(request.id, resolve);
    Promise.resolve(protocol.stdin.write(`${JSON.stringify(request)}\n`)).catch(reject);
    setTimeout(() => {
      if (pending.has(request.id)) {
        pending.delete(request.id);
        reject(new Error(`Timed out waiting for protocol response: ${request.id}`));
      }
    }, 15_000);
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

await main();
