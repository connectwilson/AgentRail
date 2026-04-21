import { PROTOCOL_NAME, PROTOCOL_SCHEMA_VERSION, PROTOCOL_VERSION } from "./protocol";

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
  "hyperliquid.account": {
    description: "Read a Hyperliquid account overview: margin/account value, spot balances, active perp positions, optional portfolio and vault summaries.",
    params: {
      user: "Hyperliquid user address",
      dex: "optional dex/subaccount identifier for clearinghouse state",
      includePerps: "optional boolean, default true",
      includeSpot: "optional boolean, default true",
      includePortfolio: "optional boolean, default true",
      includeRole: "optional boolean, default true",
      includeVaults: "optional boolean, default true"
    },
    returns: {
      marginSummary: "normalized margin/account summary",
      nonZeroSpotBalances: "spot balances with nonzero amounts",
      activePerpPositions: "perp positions with nonzero size",
      highlights: "compact human-readable highlights",
      summary: "one-line account summary"
    }
  },
  "hyperliquid.balances": {
    description: "Read the most relevant Hyperliquid balances for a user: nonzero spot balances and active perp positions.",
    params: {
      user: "Hyperliquid user address",
      dex: "optional dex/subaccount identifier"
    },
    returns: {
      spotBalances: "nonzero spot balances",
      activePerpPositions: "active perp positions",
      highlights: "compact highlights",
      summary: "one-line balance summary"
    }
  },
  "hyperliquid.orders": {
    description: "Read open and historical Hyperliquid orders for a user.",
    params: {
      user: "Hyperliquid user address",
      dex: "optional dex/subaccount identifier for open orders",
      includeOpen: "optional boolean, default true",
      includeHistorical: "optional boolean, default true",
      limit: "optional maximum number of items per list"
    },
    returns: {
      openOrders: "normalized open orders",
      historicalOrders: "normalized historical orders",
      summary: "one-line order summary"
    }
  },
  "hyperliquid.trades": {
    description: "Read Hyperliquid fills for a user, optionally scoped by time window.",
    params: {
      user: "Hyperliquid user address",
      startTime: "optional unix ms lower bound; defaults to 30 days ago",
      endTime: "optional unix ms upper bound",
      limit: "optional maximum fills to return"
    },
    returns: {
      fills: "normalized fills/trades",
      highlights: "compact trade strings",
      summary: "one-line trade summary"
    }
  },
  "hyperliquid.ledger": {
    description: "Read Hyperliquid funding and non-funding ledger updates such as deposits, withdrawals, transfers, and funding payments.",
    params: {
      user: "Hyperliquid user address",
      startTime: "optional unix ms lower bound; defaults to 30 days ago",
      endTime: "optional unix ms upper bound",
      includeFunding: "optional boolean, default true",
      includeNonFunding: "optional boolean, default true",
      limit: "optional maximum entries per category"
    },
    returns: {
      funding: "normalized funding ledger entries",
      nonFunding: "normalized non-funding ledger entries",
      summary: "one-line ledger summary"
    }
  },
  "hyperliquid.placeOrder": {
    description: "Preview-only Hyperliquid order creation. Validates market/asset resolution, builds a normalized action payload, and returns signing inputs without sending anything.",
    params: {
      user: "Hyperliquid user address",
      market: "market symbol such as BTC or PURR/USDC",
      side: "buy or sell",
      size: "order size as a string",
      orderType: "limit or market; default limit",
      price: "required for limit previews",
      tif: "optional time-in-force: Alo | Ioc | Gtc",
      reduceOnly: "optional reduce-only flag",
      slippageBps: "optional slippage bps for market previews",
      clientOrderId: "optional client order id",
      vaultAddress: "optional vault address",
      expiresAfter: "optional request expiry timestamp"
    },
    returns: {
      executionMode: "always preview-only in this phase",
      action: "normalized Hyperliquid order action payload",
      signingRequest: "payload that an external signer would need",
      summary: "one-line order preview summary"
    }
  },
  "hyperliquid.cancelOrder": {
    description: "Preview-only Hyperliquid cancel action builder. Supports orderId or clientOrderId and returns a normalized cancel payload without sending anything.",
    params: {
      user: "Hyperliquid user address",
      market: "market symbol such as BTC or PURR/USDC",
      orderId: "optional numeric order id",
      clientOrderId: "optional client order id",
      vaultAddress: "optional vault address",
      expiresAfter: "optional request expiry timestamp"
    },
    returns: {
      executionMode: "always preview-only in this phase",
      action: "normalized Hyperliquid cancel action payload",
      signingRequest: "payload that an external signer would need",
      summary: "one-line cancel preview summary"
    }
  },
  "hyperliquid.modifyOrder": {
    description: "Preview-only Hyperliquid modify action builder. Normalizes a replacement order and returns the action payload without sending anything.",
    params: {
      user: "Hyperliquid user address",
      market: "market symbol such as BTC or PURR/USDC",
      orderId: "optional numeric order id",
      clientOrderId: "optional client order id",
      side: "buy or sell",
      size: "replacement order size as a string",
      orderType: "limit or market; default limit",
      price: "required for limit previews",
      tif: "optional time-in-force: Alo | Ioc | Gtc",
      reduceOnly: "optional reduce-only flag",
      slippageBps: "optional slippage bps for market previews",
      newClientOrderId: "optional replacement client order id",
      vaultAddress: "optional vault address",
      expiresAfter: "optional request expiry timestamp"
    },
    returns: {
      executionMode: "always preview-only in this phase",
      action: "normalized Hyperliquid modify action payload",
      signingRequest: "payload that an external signer would need",
      summary: "one-line modify preview summary"
    }
  },
  "hyperliquid.signAction": {
    description: "Sign a preview-generated Hyperliquid L1 action using HYPERLIQUID_PRIVATE_KEY. Requires explicit unsafe write policy. Does not send the action.",
    params: {
      signingRequest: "the signingRequest object returned by a Hyperliquid preview method",
      policy: "must include allowWrites=true and mode=unsafe"
    },
    returns: {
      signerAddress: "address derived from the configured signing key",
      connectionId: "computed Hyperliquid action hash",
      signature: "r/s/v signature fields",
      signedAction: "payload ready for hyperliquid.sendSignedAction"
    }
  },
  "hyperliquid.sendSignedAction": {
    description: "Send an already-signed Hyperliquid action to the exchange endpoint. Requires explicit unsafe write policy.",
    params: {
      signedAction: "the signedAction object returned by hyperliquid.signAction",
      policy: "must include allowWrites=true and mode=unsafe"
    },
    returns: {
      response: "raw Hyperliquid exchange response",
      summary: "one-line send summary"
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
  "uniswap.positions": {
    description: "Read all Uniswap V3 LP NFT positions held by an owner via the NonfungiblePositionManager. Returns per-position token pair, fee tier, liquidity, and uncollected fees. Supported on Ethereum, Arbitrum, Optimism, Polygon, Base.",
    params: {
      chain: "target chain",
      owner: "wallet address to inspect",
      positionManagerAddress: "optional override for NonfungiblePositionManager address"
    },
    returns: {
      totalPositionCount: "total LP NFTs held",
      positions: "all fetched positions with pair, fee, liquidity, uncollectedFees",
      activePositions: "positions with nonzero liquidity or uncollected fees",
      highlights: "one-line summary per active position",
      summary: "human-readable summary"
    }
  },
  "wallet.portfolio": {
    description: "Scan a wallet's full asset portfolio on one chain in a single call. Aggregates native balance, registered ERC20 balances, Aave V3 supply positions, Compound V3 supply/borrow, and Uniswap V3 LP positions. Use this to answer 'what does this address hold on chain X?'",
    params: {
      chain: "target chain",
      owner: "wallet address to inspect",
      protocols: "optional subset to scan: ['aave','compound','uniswap','tokens'] — defaults to all"
    },
    returns: {
      nativeBalance: "native coin balance (ETH / BNB / MATIC)",
      tokens: "ERC20 balances for all registered tokens on the chain",
      protocols: "per-protocol position data (aave, compound, uniswap)",
      nonEmptyProtocols: "list of protocols where the wallet has assets",
      highlights: "flat ordered list of all nonzero holdings",
      summary: "human-readable one-line portfolio summary"
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
    description: "Run multiple contract.read calls in one request. Uses multicall automatically when requests share a compatible chain and block context, and falls back to single reads otherwise."
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
    name: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    description: "Agent-native onchain protocol for EVM contract discovery, reads, simulations, execution, and result decoding, plus high-value protocol adapters such as Hyperliquid account/trade history, Aave V3, Compound V3, and Uniswap V3.",
    transport: ["stdio-jsonl", "http"],
    chains: ["ethereum", "bnb", "base", "arbitrum", "optimism", "polygon", "local"],
    adapters: ["hyperliquid"],
    sdks: ["typescript", "openai-tools", "langchain-tools"],
    methods: METHOD_MANIFEST
  };
}

export function getMethodSchema(method: string) {
  return METHOD_MANIFEST[method as keyof typeof METHOD_MANIFEST] ?? null;
}
