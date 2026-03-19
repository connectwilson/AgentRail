/**
 * AgentRail Programmatic SDK
 *
 * Use this when importing AgentRail as a library rather than a CLI/stdio server.
 *
 * @example
 * ```ts
 * import { AgentRail } from "agentrail/sdk";
 *
 * const rail = new AgentRail();
 *
 * const balance = await rail.tokenBalance({
 *   chain: "ethereum",
 *   token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
 *   owner: "0xYourWallet"
 * });
 * console.log(balance.result?.formatted); // "100.00"
 * ```
 */

import {
  contractInspect,
  contractFunctions,
  contractDescribe,
  contractRead,
  batchRead,
  contractSimulate,
  txBuild,
  txSend,
  receiptDecode,
  registryLookup,
  tokenBalance,
  aavePositions,
  compoundPositions,
  uniswapQuote,
  actionPlan
} from "./methods";
import type {
  ContractParams,
  ContractFunctionParams,
  ReadParams,
  BatchReadParams,
  WriteLikeParams,
  TxBuildParams,
  TxSendParams,
  ReceiptDecodeParams,
  RegistryLookupParams,
  TokenBalanceParams,
  AavePositionsParams,
  CompoundPositionsParams,
  UniswapQuoteParams,
  ActionPlanParams,
  ResponseEnvelope
} from "./types";

export type { ResponseEnvelope };
export type {
  ContractParams,
  ContractFunctionParams,
  ReadParams,
  BatchReadParams,
  WriteLikeParams,
  TxBuildParams,
  TxSendParams,
  ReceiptDecodeParams,
  RegistryLookupParams,
  TokenBalanceParams,
  AavePositionsParams,
  CompoundPositionsParams,
  UniswapQuoteParams,
  ActionPlanParams
};

export class AgentRail {
  /** Inspect a contract: bytecode, proxy, standards, ABI source */
  inspect(params: ContractParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return contractInspect(params);
  }

  /** List callable functions from the resolved ABI */
  functions(params: ContractParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return contractFunctions(params);
  }

  /** Describe a function's inputs, risk, and preconditions */
  describe(params: ContractFunctionParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return contractDescribe(params);
  }

  /** Read a contract value */
  read(params: ReadParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return contractRead(params);
  }

  /** Run multiple reads in parallel */
  batchRead(params: BatchReadParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return batchRead(params);
  }

  /** Simulate a write call without submitting */
  simulate(params: WriteLikeParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return contractSimulate(params);
  }

  /** Build an unsigned transaction */
  buildTx(params: TxBuildParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return txBuild(params);
  }

  /** Sign and broadcast a transaction */
  sendTx(params: TxSendParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return txSend(params);
  }

  /** Decode a receipt and summarize effects */
  decodeReceipt(params: ReceiptDecodeParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return receiptDecode(params);
  }

  /** Look up known protocol/token addresses from the built-in registry */
  registryLookup(params: RegistryLookupParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return registryLookup(params);
  }

  /** Read token balance with symbol/decimals enrichment */
  tokenBalance(params: TokenBalanceParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return tokenBalance(params);
  }

  /** Read Aave V3 supplied positions for an owner */
  aavePositions(params: AavePositionsParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return aavePositions(params);
  }

  /** Read Compound V3 supply/borrow positions for an owner */
  compoundPositions(params: CompoundPositionsParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return compoundPositions(params);
  }

  /** Get a Uniswap V3 swap quote */
  uniswapQuote(params: UniswapQuoteParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return uniswapQuote(params);
  }

  /** Generate a step-by-step plan for a natural language onchain goal */
  actionPlan(params: ActionPlanParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return actionPlan(params);
  }
}

/** Singleton default instance */
export const agentRail = new AgentRail();

// Re-export all method functions for tree-shaking friendly use
export {
  contractInspect,
  contractFunctions,
  contractDescribe,
  contractRead,
  batchRead,
  contractSimulate,
  txBuild,
  txSend,
  receiptDecode,
  registryLookup,
  tokenBalance,
  aavePositions,
  compoundPositions,
  uniswapQuote,
  actionPlan
};

// Re-export utilities useful to consumers
export { lookupRegistry, getAaveMarketEntries, getCompoundMarkets } from "./registry";
export { abiCache, abiNegativeCache } from "./cache";
export { nonceManager } from "./nonce";
export { logger } from "./logger";
export { AcpError, getErrorAdvice } from "./errors";
export type { RegistryEntry } from "./registry";
export type { LogLevel } from "./logger";
