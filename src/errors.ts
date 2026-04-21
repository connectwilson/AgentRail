import type { ErrorAdvice } from "./types";

export class AcpError extends Error {
  readonly code: string;
  readonly data?: unknown;

  constructor(code: string, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export function getErrorAdvice(error: AcpError): ErrorAdvice {
  switch (error.code) {
    case "ABI_REQUIRED":
      return {
        retryable: true,
        likelyCauses: ["The target contract ABI could not be discovered automatically."],
        suggestedNextActions: [
          "Provide abi or abiPath explicitly.",
          "Provide function plus returns for simple read calls.",
          "Use registry.lookup if you need a known protocol contract address first."
        ]
      };
    case "FUNCTION_NOT_FOUND":
      return {
        retryable: true,
        likelyCauses: ["The requested function signature does not match the resolved ABI."],
        suggestedNextActions: [
          "Double-check the function signature and parameter types.",
          "Inspect the contract first with contract.functions."
        ]
      };
    case "WRITE_BLOCKED":
      return {
        retryable: true,
        likelyCauses: ["The request attempted a write while policy.allowWrites is false."],
        suggestedNextActions: [
          "Set policy.allowWrites=true for write flows.",
          "Run contract.simulate before tx.send."
        ]
      };
    case "CALLER_REQUIRED":
      return {
        retryable: true,
        likelyCauses: ["The method requires a caller address for write simulation or transaction building."],
        suggestedNextActions: [
          "Provide caller in the request.",
          "Ensure caller matches the signer for tx.send."
        ]
      };
    case "SIGNER_MISSING":
      return {
        retryable: true,
        likelyCauses: ["No private key was configured for tx.send."],
        suggestedNextActions: [
          "Set ACP_PRIVATE_KEY or PRIVATE_KEY in the environment.",
          "Use tx.build instead if you only need an unsigned transaction."
        ]
      };
    case "SIMULATION_FAILED":
      return {
        retryable: true,
        likelyCauses: [
          "The transaction would revert with the provided parameters.",
          "The caller may lack balance, allowance, or required permissions."
        ],
        suggestedNextActions: [
          "Inspect the revert reason in error.data.reason.",
          "Check balances, allowances, deadlines, and protocol preconditions."
        ]
      };
    case "RPC_REQUEST_FAILED":
      return {
        retryable: true,
        likelyCauses: [
          "The downstream RPC endpoint timed out, rejected the request, or was temporarily unavailable."
        ],
        suggestedNextActions: [
          "Retry the request or provide a custom RPC URL for the target chain.",
          "If the issue persists, set AGENTRAIL_RPC_TIMEOUT_MS, AGENTRAIL_RPC_RETRY_COUNT, or a chain-specific *_RPC_URL."
        ]
      };
    case "HYPERLIQUID_REQUEST_FAILED":
      return {
        retryable: true,
        likelyCauses: [
          "The Hyperliquid info endpoint timed out, rate limited the request, or returned an error.",
          "The supplied user address may not be the actual Hyperliquid account address you intended to query."
        ],
        suggestedNextActions: [
          "Retry the request after a short delay.",
          "Confirm the queried address is the correct Hyperliquid user, subaccount, or vault address.",
          "Set HYPERLIQUID_API_URL explicitly if you want to use a different upstream endpoint."
        ]
      };
    case "HYPERLIQUID_INVALID_RESPONSE":
      return {
        retryable: true,
        likelyCauses: [
          "Hyperliquid returned a response shape that this AgentRail version does not fully normalize yet.",
          "The selected request type may not be available for this account or time range."
        ],
        suggestedNextActions: [
          "Retry the request and inspect the raw field in the response.",
          "If this keeps happening, open an issue with the request type and returned payload."
        ]
      };
    case "TX_SEND_FAILED":
      return {
        retryable: true,
        likelyCauses: [
          "Transaction signing or broadcast failed.",
          "The network or signer configuration may be invalid."
        ],
        suggestedNextActions: [
          "Verify signer configuration and RPC connectivity.",
          "Try tx.build or contract.simulate to isolate the issue."
        ]
      };
    case "INVALID_ADDRESS":
      return {
        retryable: false,
        likelyCauses: ["The provided address is not a valid EVM address."],
        suggestedNextActions: ["Provide a checksummed or lowercase 0x-prefixed 20-byte address."]
      };
    default:
      return {
        retryable: true,
        likelyCauses: ["The request failed inside the protocol runtime or downstream RPC."],
        suggestedNextActions: [
          "Check the error message and data fields.",
          "Retry with explicit ABI and simpler parameters if possible."
        ]
      };
  }
}

export function asError(error: unknown): AcpError {
  if (error instanceof AcpError) {
    return error;
  }
  if (error instanceof Error) {
    if (/hyperliquid/i.test(error.message)) {
      return new AcpError("HYPERLIQUID_REQUEST_FAILED", error.message);
    }
    if (/HTTP request failed|fetch failed|network error|url or port/i.test(error.message)) {
      return new AcpError("RPC_REQUEST_FAILED", error.message);
    }
    return new AcpError("INTERNAL_ERROR", error.message);
  }
  return new AcpError("INTERNAL_ERROR", "Unknown error", error);
}
