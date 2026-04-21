import type { Abi } from "viem";

export type FunctionStateMutability =
  | "pure"
  | "view"
  | "nonpayable"
  | "payable";

export type SupportedChain =
  | "local"
  | "bnb"
  | "ethereum"
  | "base"
  | "arbitrum"
  | "optimism"
  | "polygon";

export type PolicyMode = "safe" | "unsafe";

export type Policy = {
  mode?: PolicyMode;
  allowWrites?: boolean;
  simulationRequired?: boolean;
  maxValueWei?: string;
  approvedContracts?: string[];
  blockedFunctions?: string[];
};

export type RequestEnvelope<TParams = Record<string, unknown>> = {
  id?: string;
  method: string;
  params: TParams;
  output?: {
    paths?: string[];
    view?: "summary-only" | "highlights-only" | "non-zero-only";
    limit?: number;
  };
};

export type ErrorAdvice = {
  retryable: boolean;
  likelyCauses: string[];
  suggestedNextActions: string[];
};

export type ResponseEnvelope<TResult = unknown> = {
  id: string;
  ok: boolean;
  result?: TResult;
  error?: {
    code: string;
    message: string;
    data?: unknown;
    advice?: ErrorAdvice;
  };
  warnings?: string[];
  meta: {
    protocol?: string;
    protocolVersion?: string;
    schemaVersion?: string;
    adapter?: string;
    chain?: SupportedChain;
    chainId?: number;
    timestamp: string;
  };
};

export type ContractParams = {
  chain: SupportedChain;
  address: string;
  abi?: Abi;
  abiPath?: string;
};

export type ContractFunctionParams = ContractParams & {
  function: string;
  returns?: string[];
  stateMutability?: FunctionStateMutability;
};

export type ReadParams = ContractFunctionParams & {
  args?: unknown[];
  blockTag?: "latest" | "safe" | "finalized" | "pending" | bigint;
  decimals?: number;
};

export type BatchReadParams = {
  items: ReadParams[];
};

export type WriteLikeParams = ContractFunctionParams & {
  args?: unknown[];
  caller?: string;
  value?: string;
  policy?: Policy;
};

export type TxBuildParams = WriteLikeParams & {
  nonce?: number;
  gas?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

export type TxSendParams = TxBuildParams & {
  signer?: "env";
};

export type ReceiptDecodeParams = ContractParams & {
  hash: string;
};

export type RegistryLookupParams = {
  chain?: SupportedChain;
  protocol?: string;
  category?: "token" | "protocol" | "market" | "contract";
  symbol?: string;
  name?: string;
  /** Free-text search — also triggers on-chain ERC20 probe if looks like an address */
  query?: string;
  /** Explicit address — triggers on-chain ERC20 probe if not found in registry */
  address?: string;
};

export type TokenBalanceParams = {
  chain: SupportedChain;
  token: string;
  owner: string;
  symbol?: string;
  decimals?: number;
  abi?: Abi;
  abiPath?: string;
};

export type AavePositionsParams = {
  chain: SupportedChain;
  owner: string;
  assets?: Array<{
    symbol: string;
    aTokenAddress: string;
    decimals?: number;
  }>;
};

export type ActionPlanParams = {
  chain: SupportedChain;
  goal: string;
  protocol?: string;
  target?: string;
  owner?: string;
  asset?: string;
  amount?: string;
};

export type CompoundPositionsParams = {
  chain: SupportedChain;
  owner: string;
  /** Optional: explicit Compound V3 market (Comet) addresses to query */
  markets?: Array<{
    address: string;
    baseToken: string;
    baseTokenDecimals: number;
  }>;
};

export type UniswapQuoteParams = {
  chain: SupportedChain;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  /** Fee tier in bps: 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1% */
  feeTier?: 100 | 500 | 3000 | 10000;
  /** Override QuoterV2 address */
  quoterAddress?: string;
};

export type RegistryAddParams = {
  entries: Array<{
    chain: SupportedChain;
    protocol: string;
    category: "token" | "protocol" | "market" | "contract";
    name: string;
    symbol?: string;
    address?: string;
    metadata?: Record<string, unknown>;
  }>;
};

export type UniswapPositionsParams = {
  chain: SupportedChain;
  owner: string;
  /** Override Uniswap V3 NonfungiblePositionManager address */
  positionManagerAddress?: string;
};

export type WalletPortfolioParams = {
  chain: SupportedChain;
  owner: string;
  /**
   * Which protocol adapters to run. Defaults to all: ["aave", "compound", "uniswap", "tokens"].
   * "tokens" scans registered ERC20 balances on the chain.
   */
  protocols?: Array<"aave" | "compound" | "uniswap" | "tokens">;
};

export type HyperliquidAccountParams = {
  user: string;
  dex?: string;
  includePerps?: boolean;
  includeSpot?: boolean;
  includePortfolio?: boolean;
  includeRole?: boolean;
  includeVaults?: boolean;
};

export type HyperliquidBalancesParams = {
  user: string;
  dex?: string;
};

export type HyperliquidOrdersParams = {
  user: string;
  dex?: string;
  includeOpen?: boolean;
  includeHistorical?: boolean;
  limit?: number;
};

export type HyperliquidTradesParams = {
  user: string;
  startTime?: number;
  endTime?: number;
  aggregateByTime?: boolean;
  limit?: number;
};

export type HyperliquidLedgerParams = {
  user: string;
  startTime?: number;
  endTime?: number;
  includeFunding?: boolean;
  includeNonFunding?: boolean;
  limit?: number;
};

export type HyperliquidPlaceOrderParams = {
  user: string;
  market: string;
  side: "buy" | "sell";
  size: string;
  orderType?: "limit" | "market";
  price?: string;
  tif?: "Alo" | "Ioc" | "Gtc";
  reduceOnly?: boolean;
  dex?: string;
  vaultAddress?: string;
  expiresAfter?: number;
  slippageBps?: number;
  clientOrderId?: string;
};

export type HyperliquidCancelOrderParams = {
  user: string;
  market: string;
  orderId?: number | string;
  clientOrderId?: string;
  vaultAddress?: string;
  expiresAfter?: number;
};

export type HyperliquidModifyOrderParams = {
  user: string;
  market: string;
  orderId?: number | string;
  clientOrderId?: string;
  side: "buy" | "sell";
  size: string;
  orderType?: "limit" | "market";
  price?: string;
  tif?: "Alo" | "Ioc" | "Gtc";
  reduceOnly?: boolean;
  vaultAddress?: string;
  expiresAfter?: number;
  slippageBps?: number;
  newClientOrderId?: string;
};

export type HyperliquidSignActionParams = {
  user?: string;
  signingRequest: {
    action: Record<string, unknown>;
    nonce: number;
    vaultAddress?: string | null;
    expiresAfter?: number | null;
  };
  policy?: Policy;
};

export type HyperliquidSendSignedActionParams = {
  signedAction: {
    action: Record<string, unknown>;
    nonce: number;
    signature: {
      r: string;
      s: string;
      v: number;
    };
    vaultAddress?: string | null;
    expiresAfter?: number | null;
  };
  policy?: Policy;
};
