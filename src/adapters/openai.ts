/**
 * OpenAI Function Calling / Tool Use adapter for AgentRail.
 *
 * Exports AgentRail methods as OpenAI-compatible tool definitions that can be
 * passed directly to `openai.chat.completions.create({ tools: agentRailTools })`.
 *
 * @example
 * ```ts
 * import { agentRailTools, handleAgentRailToolCall } from "agentrail/adapters/openai";
 * import { AgentRail } from "agentrail/sdk";
 *
 * const rail = new AgentRail();
 * const response = await openai.chat.completions.create({
 *   model: "gpt-4o",
 *   tools: agentRailTools,
 *   messages: [{ role: "user", content: "What is my USDC balance on Ethereum?" }]
 * });
 *
 * for (const toolCall of response.choices[0].message.tool_calls ?? []) {
 *   const result = await handleAgentRailToolCall(rail, toolCall);
 *   // add result to messages and continue...
 * }
 * ```
 */

import { AgentRail } from "../sdk";

export type OpenAITool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
};

const CHAIN_ENUM = ["ethereum", "bnb", "base", "arbitrum", "optimism", "polygon", "local"];

export const agentRailTools: OpenAITool[] = [
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_place_order",
      description: "Build a preview-only Hyperliquid order action. Validates and normalizes an order payload without signing or sending it.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Hyperliquid user address" },
          market: { type: "string", description: "Market symbol e.g. BTC or PURR/USDC" },
          side: { type: "string", description: "buy or sell", enum: ["buy", "sell"] },
          size: { type: "string", description: "Order size" },
          orderType: { type: "string", description: "limit or market", enum: ["limit", "market"] },
          price: { type: "string", description: "Required for limit previews" },
          tif: { type: "string", description: "Time in force", enum: ["Alo", "Ioc", "Gtc"] },
          reduceOnly: { type: "string", description: "Optional reduce-only flag as true/false" }
        },
        required: ["user", "market", "side", "size"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_cancel_order",
      description: "Build a preview-only Hyperliquid cancel action for an order id or client order id.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Hyperliquid user address" },
          market: { type: "string", description: "Market symbol e.g. BTC or PURR/USDC" },
          orderId: { type: "string", description: "Numeric order id" },
          clientOrderId: { type: "string", description: "Client order id" }
        },
        required: ["user", "market"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_modify_order",
      description: "Build a preview-only Hyperliquid modify action for an existing order.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Hyperliquid user address" },
          market: { type: "string", description: "Market symbol e.g. BTC or PURR/USDC" },
          orderId: { type: "string", description: "Numeric order id" },
          clientOrderId: { type: "string", description: "Client order id" },
          side: { type: "string", description: "buy or sell", enum: ["buy", "sell"] },
          size: { type: "string", description: "Replacement order size" },
          orderType: { type: "string", description: "limit or market", enum: ["limit", "market"] },
          price: { type: "string", description: "Required for limit previews" }
        },
        required: ["user", "market", "side", "size"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_sign_action",
      description: "Sign a Hyperliquid action using HYPERLIQUID_PRIVATE_KEY. Requires explicit unsafe write policy and does not send.",
      parameters: {
        type: "object",
        properties: {
          signingRequest: { type: "string", description: "JSON object returned by a Hyperliquid preview method" }
        },
        required: ["signingRequest"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_send_signed_action",
      description: "Send an already signed Hyperliquid action to the exchange endpoint. Requires explicit unsafe write policy.",
      parameters: {
        type: "object",
        properties: {
          signedAction: { type: "string", description: "JSON object returned by hyperliquid.signAction" }
        },
        required: ["signedAction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_account",
      description: "Read a Hyperliquid account overview including balances, active perp positions, and account summary.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Hyperliquid user address" },
          dex: { type: "string", description: "Optional dex or subaccount identifier" }
        },
        required: ["user"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_orders",
      description: "Read open and historical Hyperliquid orders for a user.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Hyperliquid user address" },
          dex: { type: "string", description: "Optional dex or subaccount identifier" },
          limit: { type: "number", description: "Optional maximum number of orders per category" }
        },
        required: ["user"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_hyperliquid_trades",
      description: "Read recent Hyperliquid fills/trades for a user.",
      parameters: {
        type: "object",
        properties: {
          user: { type: "string", description: "Hyperliquid user address" },
          startTime: { type: "number", description: "Optional unix ms start time" },
          endTime: { type: "number", description: "Optional unix ms end time" },
          limit: { type: "number", description: "Optional maximum number of fills" }
        },
        required: ["user"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_registry_lookup",
      description: "Look up known protocol, market, token, or contract addresses from the AgentRail registry.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Chain: ethereum, bnb, base, arbitrum, optimism, polygon", enum: CHAIN_ENUM },
          protocol: { type: "string", description: "Protocol name e.g. aave, uniswap, compound" },
          symbol: { type: "string", description: "Token symbol e.g. WETH, USDC" },
          category: { type: "string", description: "Category: token, protocol, market, contract", enum: ["token", "protocol", "market", "contract"] },
          query: { type: "string", description: "Free-text search query" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_token_balance",
      description: "Read a token balance for an owner with formatted output and symbol/decimals enrichment.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          token: { type: "string", description: "Token contract address" },
          owner: { type: "string", description: "Wallet address to inspect" },
          decimals: { type: "number", description: "Optional decimals override" }
        },
        required: ["chain", "token", "owner"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_aave_positions",
      description: "Read Aave V3 supplied positions for an owner on any supported chain.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          owner: { type: "string", description: "Wallet address to inspect" }
        },
        required: ["chain", "owner"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_compound_positions",
      description: "Read Compound V3 supply and borrow positions for an owner.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          owner: { type: "string", description: "Wallet address to inspect" }
        },
        required: ["chain", "owner"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_uniswap_quote",
      description: "Get a Uniswap V3 swap quote for a token pair.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          tokenIn: { type: "string", description: "Input token address" },
          tokenOut: { type: "string", description: "Output token address" },
          amountIn: { type: "string", description: "Amount in as a raw integer string (wei)" },
          feeTier: { type: "number", description: "Fee tier in bps: 100, 500, 3000, or 10000" }
        },
        required: ["chain", "tokenIn", "tokenOut", "amountIn"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_contract_read",
      description: "Read any EVM contract function using ABI or minimal function signature.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          address: { type: "string", description: "Contract address" },
          function: { type: "string", description: "Function signature e.g. balanceOf(address)" },
          args: { type: "string", description: "JSON array of arguments" },
          returns: { type: "string", description: "JSON array of return types e.g. [\"uint256\"]" },
          decimals: { type: "number", description: "Decimals for formatted output" }
        },
        required: ["chain", "address", "function"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_contract_inspect",
      description: "Inspect a contract for bytecode size, proxy info, detected standards, and ABI source.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          address: { type: "string", description: "Contract address" }
        },
        required: ["chain", "address"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_contract_simulate",
      description: "Simulate a write transaction to check if it would succeed before sending.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          address: { type: "string", description: "Contract address" },
          function: { type: "string", description: "Function signature" },
          args: { type: "string", description: "JSON array of arguments" },
          caller: { type: "string", description: "Caller wallet address" },
          value: { type: "string", description: "Native value in wei" }
        },
        required: ["chain", "address", "function", "caller"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "agentrail_action_plan",
      description: "Generate a step-by-step plan for a natural language onchain goal.",
      parameters: {
        type: "object",
        properties: {
          chain: { type: "string", description: "Target chain", enum: CHAIN_ENUM },
          goal: { type: "string", description: "Natural language goal e.g. 'read my Aave positions'" },
          protocol: { type: "string", description: "Protocol hint e.g. aave" },
          owner: { type: "string", description: "Owner wallet address" },
          asset: { type: "string", description: "Asset symbol hint" },
          amount: { type: "string", description: "Amount hint" }
        },
        required: ["chain", "goal"]
      }
    }
  }
];

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

/**
 * Handle a single OpenAI tool call and return a tool result message.
 */
export async function handleAgentRailToolCall(
  rail: AgentRail,
  toolCall: OpenAIToolCall
): Promise<{ role: "tool"; tool_call_id: string; content: string }> {
  const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

  // Parse array-encoded fields that come as JSON strings from the model
  if (typeof args["args"] === "string") {
    try { args["args"] = JSON.parse(args["args"] as string); } catch { /* keep as-is */ }
  }
  if (typeof args["returns"] === "string") {
    try { args["returns"] = JSON.parse(args["returns"] as string); } catch { /* keep as-is */ }
  }
  if (typeof args["signingRequest"] === "string") {
    try { args["signingRequest"] = JSON.parse(args["signingRequest"] as string); } catch { /* keep as-is */ }
  }
  if (typeof args["signedAction"] === "string") {
    try { args["signedAction"] = JSON.parse(args["signedAction"] as string); } catch { /* keep as-is */ }
  }

  let result: unknown;
  try {
    switch (toolCall.function.name) {
      case "agentrail_hyperliquid_sign_action": result = await rail.hyperliquidSignAction(Object.assign({}, args, { policy: { allowWrites: true, mode: "unsafe", simulationRequired: false } }) as never); break;
      case "agentrail_hyperliquid_send_signed_action": result = await rail.hyperliquidSendSignedAction(Object.assign({}, args, { policy: { allowWrites: true, mode: "unsafe", simulationRequired: false } }) as never); break;
      case "agentrail_hyperliquid_place_order": result = await rail.hyperliquidPlaceOrder(args as never); break;
      case "agentrail_hyperliquid_cancel_order": result = await rail.hyperliquidCancelOrder(args as never); break;
      case "agentrail_hyperliquid_modify_order": result = await rail.hyperliquidModifyOrder(args as never); break;
      case "agentrail_hyperliquid_account": result = await rail.hyperliquidAccount(args as never); break;
      case "agentrail_hyperliquid_orders": result = await rail.hyperliquidOrders(args as never); break;
      case "agentrail_hyperliquid_trades": result = await rail.hyperliquidTrades(args as never); break;
      case "agentrail_registry_lookup": result = await rail.registryLookup(args as never); break;
      case "agentrail_token_balance": result = await rail.tokenBalance(args as never); break;
      case "agentrail_aave_positions": result = await rail.aavePositions(args as never); break;
      case "agentrail_compound_positions": result = await rail.compoundPositions(args as never); break;
      case "agentrail_uniswap_quote": result = await rail.uniswapQuote(args as never); break;
      case "agentrail_contract_read": result = await rail.read(args as never); break;
      case "agentrail_contract_inspect": result = await rail.inspect(args as never); break;
      case "agentrail_contract_simulate": result = await rail.simulate(Object.assign({}, args, { policy: { allowWrites: true, simulationRequired: true } }) as never); break;
      case "agentrail_action_plan": result = await rail.actionPlan(args as never); break;
      default: result = { ok: false, error: { message: `Unknown AgentRail tool: ${toolCall.function.name}` } };
    }
  } catch (error) {
    result = { ok: false, error: { message: error instanceof Error ? error.message : String(error) } };
  }

  return {
    role: "tool",
    tool_call_id: toolCall.id,
    content: JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v)
  };
}
