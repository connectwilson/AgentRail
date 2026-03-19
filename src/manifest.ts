export const METHOD_MANIFEST = {
  "registry.lookup": {
    description: "Look up known protocol, market, token, or contract addresses from the built-in registry. Covers Aave V3 (all chains), Uniswap V3, Compound V3, Lido, Curve, and major tokens on Ethereum/BNB/Base/Arbitrum/Optimism/Polygon.",
    params: {
      chain: "optional chain id label such as bnb, ethereum, base, arbitrum, optimism, or polygon",
      protocol: "optional protocol name such as aave, uniswap, compound, lido, curve",
      category: "optional category: token | protocol | market | contract",
      symbol: "optional symbol filter such as WBNB or USDC",
      name: "optional partial name filter",
      query: "optional free-text search"
    },
    returns: {
      entries: "list of matching registry entries",
      bestMatch: "best matching registry entry when available",
      summary: "human-readable summary"
    }
  },
  "registry.add": {
    description: "Dynamically add entries to the in-process registry at runtime. Entries persist for the lifetime of the server session. Use this to register project-specific contracts, custom tokens, or protocols not in the built-in registry.",
    params: {
      entries: "array of registry entries, each with chain, protocol, category, name, and optional symbol/address/metadata"
    },
    returns: {
      added: "number of entries added",
      entries: "the added entries",
      summary: "human-readable confirmation"
    }
  },
  "token.balance": {
    description: "Read a token balance for an owner with automatic symbol/decimals enrichment and human-readable formatted value.",
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
    description: "Read Aave V3 supplied balances for an owner across all known markets on the target chain. Supports Ethereum, BNB, Base, Arbitrum, Optimism, and Polygon.",
    params: {
      chain: "target chain",
      owner: "wallet address to inspect",
      assets: "optional explicit asset list to override registry defaults"
    },
    returns: {
      highlights: "non-zero supplied positions only",
      summary: "human-readable summary",
      positions: "all tracked positions",
      nonZeroPositions: "only positions with nonzero balance"
    }
  },
  "compound.positions": {
    description: "Read Compound V3 (Comet) supply and borrow positions for an owner across all known markets on the chain.",
    params: {
      chain: "target chain (ethereum, base, arbitrum, polygon supported)",
      owner: "wallet address to inspect",
      markets: "optional explicit market list to override registry defaults"
    },
    returns: {
      positions: "per-market supply and borrow positions",
      activePositions: "only markets with nonzero supply or borrow",
      summary: "human-readable summary"
    }
  },
  "uniswap.quote": {
    description: "Get a Uniswap V3 exact-input swap quote using the on-chain QuoterV2. Returns amountOut, formatted values, and gas estimate.",
    params: {
      chain: "target chain (ethereum, arbitrum, base, optimism, polygon supported)",
      tokenIn: "input token address",
      tokenOut: "output token address",
      amountIn: "input amount as raw integer string (wei)",
      feeTier: "optional fee tier in bps: 100 | 500 | 3000 | 10000 (default 3000)",
      quoterAddress: "optional QuoterV2 address override"
    },
    returns: {
      amountOut: "raw output amount",
      amountOutFormatted: "formatted output amount if decimals resolvable",
      gasEstimate: "estimated gas for the swap",
      summary: "human-readable quote summary"
    }
  },
  "action.plan": {
    description: "Return a lightweight step-by-step plan for a common onchain goal expressed in natural language.",
    params: {
      chain: "target chain",
      goal: "natural language goal e.g. 'read my Aave positions' or 'deposit USDC to Aave'",
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
    description: "Inspect a contract for bytecode, proxy implementation (EIP-1967), detected standards (ERC20/ERC721/ERC1155/ERC4626), and ABI source.",
    params: {
      chain: "target chain",
      address: "contract address",
      abi: "optional ABI override",
      abiPath: "optional ABI path"
    }
  },
  "contract.functions": {
    description: "List all callable functions from the resolved ABI with risk levels."
  },
  "contract.describe": {
    description: "Describe a specific function: its inputs with semantic types, outputs, risk level, and preconditions."
  },
  "contract.read": {
    description: "Read a contract function using full ABI, auto-resolved ABI (Sourcify/Explorer), built-in standards, or minimal function signature + returns.",
    params: {
      chain: "target chain",
      address: "contract address",
      function: "function signature such as balanceOf(address)",
      args: "optional argument array",
      returns: "optional return type array for minimal ABI mode e.g. ['uint256']",
      decimals: "optional decimals for formatted token output"
    }
  },
  "batch.read": {
    description: "Run multiple contract.read calls in parallel in a single request."
  },
  "contract.simulate": {
    description: "Simulate a write contract call with policy enforcement. Safe — does not submit to chain. Returns gas estimate and simulation result."
  },
  "tx.build": {
    description: "Build an unsigned EIP-1559 transaction payload with gas estimation and fee estimation."
  },
  "tx.send": {
    description: "Sign and broadcast a transaction using the configured signer (ACP_PRIVATE_KEY env var) with policy enforcement and nonce management."
  },
  "receipt.decode": {
    description: "Decode a transaction receipt: parse event logs, summarize token transfers and approvals, return structured effects."
  }
} as const;

export function getLlmManifest() {
  return {
    name: "AgentRail",
    version: "0.2.0",
    description: "Agent-native onchain protocol for EVM contract discovery, reads, simulations, execution, and result decoding. Supports Aave V3, Compound V3, Uniswap V3, Lido, Curve, and all major tokens across 6 chains.",
    transport: ["stdio-jsonl", "http"],
    chains: ["ethereum", "bnb", "base", "arbitrum", "optimism", "polygon", "local"],
    sdks: ["typescript", "openai-tools", "langchain-tools"],
    methods: METHOD_MANIFEST
  };
}

export function getMethodSchema(method: string) {
  return METHOD_MANIFEST[method as keyof typeof METHOD_MANIFEST] ?? null;
}
