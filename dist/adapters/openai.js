// src/adapters/openai.ts
var CHAIN_ENUM = ["ethereum", "bnb", "base", "arbitrum", "optimism", "polygon", "local"];
var agentRailTools = [
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
          returns: { type: "string", description: 'JSON array of return types e.g. ["uint256"]' },
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
async function handleAgentRailToolCall(rail, toolCall) {
  const args = JSON.parse(toolCall.function.arguments);
  if (typeof args["args"] === "string") {
    try {
      args["args"] = JSON.parse(args["args"]);
    } catch {}
  }
  if (typeof args["returns"] === "string") {
    try {
      args["returns"] = JSON.parse(args["returns"]);
    } catch {}
  }
  let result;
  try {
    switch (toolCall.function.name) {
      case "agentrail_registry_lookup":
        result = await rail.registryLookup(args);
        break;
      case "agentrail_token_balance":
        result = await rail.tokenBalance(args);
        break;
      case "agentrail_aave_positions":
        result = await rail.aavePositions(args);
        break;
      case "agentrail_compound_positions":
        result = await rail.compoundPositions(args);
        break;
      case "agentrail_uniswap_quote":
        result = await rail.uniswapQuote(args);
        break;
      case "agentrail_contract_read":
        result = await rail.read(args);
        break;
      case "agentrail_contract_inspect":
        result = await rail.inspect(args);
        break;
      case "agentrail_contract_simulate":
        result = await rail.simulate(Object.assign({}, args, { policy: { allowWrites: true, simulationRequired: true } }));
        break;
      case "agentrail_action_plan":
        result = await rail.actionPlan(args);
        break;
      default:
        result = { ok: false, error: { message: `Unknown AgentRail tool: ${toolCall.function.name}` } };
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
export {
  handleAgentRailToolCall,
  agentRailTools
};
