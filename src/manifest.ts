export const METHOD_MANIFEST = {
  "registry.lookup": {
    description: "Look up known protocol, market, token, or contract addresses from the built-in registry.",
    params: {
      chain: "optional chain id label such as bnb or ethereum",
      protocol: "optional protocol name such as aave or uniswap",
      category: "optional category: token | protocol | market | contract",
      symbol: "optional symbol filter such as WBNB",
      name: "optional partial name filter",
      query: "optional free-text search"
    },
    returns: {
      entries: "list of matching registry entries",
      bestMatch: "best matching registry entry when available",
      summary: "human-readable summary"
    }
  },
  "token.balance": {
    description: "Read a token balance for an owner with automatic metadata and formatted value enrichment.",
    params: {
      chain: "target chain",
      token: "token contract address",
      owner: "wallet address to inspect",
      symbol: "optional symbol override",
      decimals: "optional decimals override",
      abi: "optional ABI override",
      abiPath: "optional ABI file path"
    },
    returns: {
      raw: "raw integer token balance",
      formatted: "human-readable value if decimals are known",
      symbol: "resolved token symbol"
    }
  },
  "aave.positions": {
    description: "Read known Aave supplied balances for the owner on the target chain.",
    params: {
      chain: "target chain",
      owner: "wallet address to inspect",
      assets: "optional explicit asset list to override registry defaults"
    },
    returns: {
      highlights: "non-zero supplied positions only",
      summary: "human-readable summary",
      positions: "all tracked positions"
    }
  },
  "action.plan": {
    description: "Return a lightweight plan for a common onchain goal.",
    params: {
      chain: "target chain",
      goal: "natural language goal",
      protocol: "optional protocol hint",
      target: "optional contract or target hint",
      owner: "optional owner address",
      asset: "optional asset symbol",
      amount: "optional amount"
    },
    returns: {
      steps: "ordered plan steps with suggested methods"
    }
  },
  "contract.inspect": {
    description: "Inspect a contract for bytecode, proxy info, standards, and ABI source.",
    params: {
      chain: "target chain",
      address: "contract address",
      abi: "optional ABI override",
      abiPath: "optional ABI path"
    }
  },
  "contract.functions": {
    description: "List callable functions from the resolved ABI."
  },
  "contract.describe": {
    description: "Describe a function signature, its inputs, risks, and preconditions."
  },
  "contract.read": {
    description: "Read a contract function using full ABI, resolved ABI, or minimal signature + returns.",
    params: {
      chain: "target chain",
      address: "contract address",
      function: "function signature such as balanceOf(address)",
      args: "optional argument array",
      returns: "optional return type array for minimal ABI mode",
      decimals: "optional decimals for formatted output"
    }
  },
  "batch.read": {
    description: "Run multiple contract.read calls in one request."
  },
  "contract.simulate": {
    description: "Simulate a write contract call with policy enforcement."
  },
  "tx.build": {
    description: "Build an unsigned transaction."
  },
  "tx.send": {
    description: "Send a transaction using the configured signer and policy guard."
  },
  "receipt.decode": {
    description: "Decode a transaction receipt and summarize recognized effects."
  }
} as const;

export function getLlmManifest() {
  return {
    name: "AgentRail",
    version: "0.1.0",
    description: "Agent-native onchain protocol for EVM contract discovery, reads, simulations, execution, and result decoding.",
    methods: METHOD_MANIFEST
  };
}

export function getMethodSchema(method: string) {
  return METHOD_MANIFEST[method as keyof typeof METHOD_MANIFEST] ?? null;
}
