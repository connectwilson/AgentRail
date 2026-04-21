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
  hyperliquidAccount,
  hyperliquidBalances,
  hyperliquidCancelOrder,
  hyperliquidModifyOrder,
  hyperliquidOrders,
  hyperliquidPlaceOrder,
  hyperliquidSendSignedAction,
  hyperliquidSignAction,
  hyperliquidTrades,
  hyperliquidLedger,
  aavePositions,
  compoundPositions,
  uniswapQuote,
  uniswapPositions,
  walletPortfolio,
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
  HyperliquidAccountParams,
  HyperliquidBalancesParams,
  HyperliquidCancelOrderParams,
  HyperliquidOrdersParams,
  HyperliquidModifyOrderParams,
  HyperliquidPlaceOrderParams,
  HyperliquidSendSignedActionParams,
  HyperliquidSignActionParams,
  HyperliquidTradesParams,
  HyperliquidLedgerParams,
  AavePositionsParams,
  CompoundPositionsParams,
  UniswapQuoteParams,
  UniswapPositionsParams,
  WalletPortfolioParams,
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
  HyperliquidAccountParams,
  HyperliquidBalancesParams,
  HyperliquidCancelOrderParams,
  HyperliquidOrdersParams,
  HyperliquidModifyOrderParams,
  HyperliquidPlaceOrderParams,
  HyperliquidSendSignedActionParams,
  HyperliquidSignActionParams,
  HyperliquidTradesParams,
  HyperliquidLedgerParams,
  AavePositionsParams,
  CompoundPositionsParams,
  UniswapQuoteParams,
  UniswapPositionsParams,
  WalletPortfolioParams,
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

  /** Read a Hyperliquid account overview */
  hyperliquidAccount(params: HyperliquidAccountParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidAccount(params);
  }

  /** Read Hyperliquid balances and active positions */
  hyperliquidBalances(params: HyperliquidBalancesParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidBalances(params);
  }

  /** Build a preview-only Hyperliquid place order action */
  hyperliquidPlaceOrder(params: HyperliquidPlaceOrderParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidPlaceOrder(params);
  }

  /** Build a preview-only Hyperliquid cancel action */
  hyperliquidCancelOrder(params: HyperliquidCancelOrderParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidCancelOrder(params);
  }

  /** Build a preview-only Hyperliquid modify action */
  hyperliquidModifyOrder(params: HyperliquidModifyOrderParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidModifyOrder(params);
  }

  /** Sign a Hyperliquid action using the configured Hyperliquid signing key */
  hyperliquidSignAction(params: HyperliquidSignActionParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidSignAction(params);
  }

  /** Send a previously signed Hyperliquid action to the exchange endpoint */
  hyperliquidSendSignedAction(params: HyperliquidSendSignedActionParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidSendSignedAction(params);
  }

  /** Read Hyperliquid open and historical orders */
  hyperliquidOrders(params: HyperliquidOrdersParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidOrders(params);
  }

  /** Read Hyperliquid fills/trades */
  hyperliquidTrades(params: HyperliquidTradesParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidTrades(params);
  }

  /** Read Hyperliquid funding and non-funding ledger activity */
  hyperliquidLedger(params: HyperliquidLedgerParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return hyperliquidLedger(params);
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

  /** Read all Uniswap V3 LP NFT positions for an owner (pair, fee tier, liquidity, uncollected fees) */
  uniswapPositions(params: UniswapPositionsParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return uniswapPositions(params);
  }

  /** Scan a wallet's full asset portfolio: native balance, ERC20s, Aave, Compound, Uniswap LP */
  walletPortfolio(params: WalletPortfolioParams): Promise<ResponseEnvelope<Record<string, unknown>>> {
    return walletPortfolio(params);
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
  hyperliquidAccount,
  hyperliquidBalances,
  hyperliquidCancelOrder,
  hyperliquidModifyOrder,
  hyperliquidOrders,
  hyperliquidPlaceOrder,
  hyperliquidSendSignedAction,
  hyperliquidSignAction,
  hyperliquidTrades,
  hyperliquidLedger,
  aavePositions,
  compoundPositions,
  uniswapQuote,
  uniswapPositions,
  walletPortfolio,
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
