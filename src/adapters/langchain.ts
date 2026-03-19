/**
 * LangChain Tool adapter for AgentRail.
 *
 * Exports AgentRail methods as LangChain-compatible DynamicStructuredTool definitions.
 * Works with LangChain.js v0.2+.
 *
 * @example
 * ```ts
 * import { createAgentRailLangChainTools } from "agentrail/adapters/langchain";
 * import { AgentRail } from "agentrail/sdk";
 * import { createOpenAIFunctionsAgent } from "langchain/agents";
 *
 * const rail = new AgentRail();
 * const tools = createAgentRailLangChainTools(rail);
 *
 * const agent = await createOpenAIFunctionsAgent({ llm, tools, prompt });
 * ```
 *
 * NOTE: This module does NOT import from langchain directly to avoid
 * making it a required dependency. It returns plain objects that match
 * the LangChain DynamicStructuredTool interface — cast as needed.
 */

import { AgentRail } from "../sdk";

type AgentRailLangChainTool = {
  name: string;
  description: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  func: (input: Record<string, unknown>) => Promise<string>;
};

const CHAIN_DESCRIPTION = "Chain: ethereum, bnb, base, arbitrum, optimism, polygon, or local";

export function createAgentRailLangChainTools(rail: AgentRail): AgentRailLangChainTool[] {
  function stringify(value: unknown): string {
    return JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v);
  }

  return [
    {
      name: "agentrail_registry_lookup",
      description: "Look up known DeFi protocol, token, or contract addresses by chain, protocol name, or symbol.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          protocol: { type: "string", description: "Protocol name e.g. aave, uniswap, compound, lido, curve" },
          symbol: { type: "string", description: "Token symbol e.g. USDC, WETH" },
          query: { type: "string", description: "Free-text search" }
        }
      },
      func: async (input) => stringify(await rail.registryLookup(input as never))
    },
    {
      name: "agentrail_token_balance",
      description: "Read a token ERC20 balance for a wallet address. Returns raw, formatted, and symbol.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          token: { type: "string", description: "ERC20 token contract address" },
          owner: { type: "string", description: "Wallet address" },
          decimals: { type: "number", description: "Decimals override (optional)" }
        },
        required: ["chain", "token", "owner"]
      },
      func: async (input) => stringify(await rail.tokenBalance(input as never))
    },
    {
      name: "agentrail_aave_positions",
      description: "Read Aave V3 supply positions for a wallet across all known markets on the chain.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          owner: { type: "string", description: "Wallet address" }
        },
        required: ["chain", "owner"]
      },
      func: async (input) => stringify(await rail.aavePositions(input as never))
    },
    {
      name: "agentrail_compound_positions",
      description: "Read Compound V3 supply and borrow positions for a wallet.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          owner: { type: "string", description: "Wallet address" }
        },
        required: ["chain", "owner"]
      },
      func: async (input) => stringify(await rail.compoundPositions(input as never))
    },
    {
      name: "agentrail_uniswap_quote",
      description: "Get a Uniswap V3 quote for swapping one token to another. Returns amountOut and gas estimate.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          tokenIn: { type: "string", description: "Input token address" },
          tokenOut: { type: "string", description: "Output token address" },
          amountIn: { type: "string", description: "Input amount as raw integer string (e.g. '1000000' for 1 USDC)" },
          feeTier: { type: "number", description: "Fee tier: 100, 500, 3000, or 10000" }
        },
        required: ["chain", "tokenIn", "tokenOut", "amountIn"]
      },
      func: async (input) => stringify(await rail.uniswapQuote(input as never))
    },
    {
      name: "agentrail_contract_read",
      description: "Read any view/pure function from any EVM smart contract.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          address: { type: "string", description: "Contract address" },
          function: { type: "string", description: "Function signature e.g. balanceOf(address)" },
          args: { type: "array", description: "Array of arguments", items: { type: "string" } },
          returns: { type: "array", description: "Array of return types e.g. ['uint256']", items: { type: "string" } },
          decimals: { type: "number", description: "Decimals for formatted output" }
        },
        required: ["chain", "address", "function"]
      },
      func: async (input) => stringify(await rail.read(input as never))
    },
    {
      name: "agentrail_contract_inspect",
      description: "Inspect a contract: check if it exists, detect standards (ERC20/ERC721), find proxy implementation.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          address: { type: "string", description: "Contract address" }
        },
        required: ["chain", "address"]
      },
      func: async (input) => stringify(await rail.inspect(input as never))
    },
    {
      name: "agentrail_contract_simulate",
      description: "Simulate a write transaction to verify it would succeed. Safe — does not submit to chain.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          address: { type: "string", description: "Contract address" },
          function: { type: "string", description: "Function signature" },
          args: { type: "array", description: "Function arguments", items: { type: "string" } },
          caller: { type: "string", description: "Caller address for simulation" },
          value: { type: "string", description: "Native value in wei (optional)" },
          stateMutability: { type: "string", description: "nonpayable or payable" }
        },
        required: ["chain", "address", "function", "caller"]
      },
      func: async (input) =>
        stringify(
          await rail.simulate(Object.assign({}, input, { policy: { allowWrites: true, simulationRequired: true } }) as never)
        )
    },
    {
      name: "agentrail_action_plan",
      description: "Generate a step-by-step plan for an onchain goal like 'check my Aave positions' or 'deposit USDC to Aave'.",
      schema: {
        type: "object",
        properties: {
          chain: { type: "string", description: CHAIN_DESCRIPTION },
          goal: { type: "string", description: "Natural language goal" },
          protocol: { type: "string", description: "Protocol hint" },
          owner: { type: "string", description: "Wallet address" },
          asset: { type: "string", description: "Asset symbol" },
          amount: { type: "string", description: "Amount" }
        },
        required: ["chain", "goal"]
      },
      func: async (input) => stringify(await rail.actionPlan(input as never))
    }
  ];
}
