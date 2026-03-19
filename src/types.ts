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
