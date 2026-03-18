import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { buildMinimalAbiFromSignature, normalizeAbiJson } from "./abi";
import { getLlmManifest, getMethodSchema } from "./manifest";
import { mergePolicy } from "./policy";
import { getAaveMarketEntries, lookupRegistry } from "./registry";
import { decodeLogWithAbi, formatTokenValue, semanticTypeFromInput, summarizeFunctionRisk } from "./utils";
import type { RequestEnvelope } from "./types";

describe("semantic helpers", () => {
  test("maps token-like integers", () => {
    expect(semanticTypeFromInput("amount", "uint256")).toBe("token_amount");
  });

  test("flags approval risk as high", () => {
    expect(summarizeFunctionRisk("approve")).toBe("high");
  });

  test("normalizes explorer ABI json", () => {
    const abi = normalizeAbiJson(
      '[{"type":"function","stateMutability":"view","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string"}]}]'
    );
    expect(Array.isArray(abi)).toBe(true);
    expect(abi[0]?.type).toBe("function");
  });

  test("defaults policy to safe write-disabled mode", () => {
    const policy = mergePolicy();
    expect(policy.allowWrites).toBe(false);
    expect(policy.simulationRequired).toBe(true);
    expect(policy.mode).toBe("safe");
  });

  test("request envelope shape supports rpc server mode", () => {
    const request: RequestEnvelope = {
      id: "1",
      method: "rpc.discover",
      params: {}
    };
    expect(request.method).toBe("rpc.discover");
  });

  test("decodes erc20 transfer event logs", () => {
    const abi = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    const topics = encodeEventTopics({
      abi,
      eventName: "Transfer",
      args: {
        from: "0x0000000000000000000000000000000000000001",
        to: "0x0000000000000000000000000000000000000002"
      }
    }).filter(Boolean) as `0x${string}`[];
    const data = encodeAbiParameters(
      [{ type: "uint256" }],
      [42n]
    );
    const decoded = decodeLogWithAbi({
      abi,
      data,
      topics
    });
    expect(decoded).toBeTruthy();
    if (!decoded) {
      throw new Error("Expected transfer log to decode");
    }
    if (decoded.eventName !== "Transfer") {
      throw new Error(`Expected Transfer event, got ${String(decoded.eventName)}`);
    }
    const args = decoded && !Array.isArray(decoded.args) && decoded.args ? decoded.args : {};
    expect((args as { value?: bigint }).value).toBe(42n);
  });

  test("request envelope can target bnb chain", () => {
    const request: RequestEnvelope = {
      id: "bnb-1",
      method: "contract.read",
      params: {
        chain: "bnb",
        address: "0x0000000000000000000000000000000000000001"
      }
    };
    expect((request.params as { chain: string }).chain).toBe("bnb");
  });

  test("builds minimal abi from function signature", () => {
    const abi = buildMinimalAbiFromSignature({
      functionSignature: "balanceOf(address)",
      returns: ["uint256"],
      stateMutability: "view"
    });
    expect(Array.isArray(abi)).toBe(true);
    expect(abi[0]?.type).toBe("function");
  });

  test("formats token values with decimals", () => {
    expect(formatTokenValue(10003557142776725n, 18)).toBe("0.010003557142776725");
  });

  test("finds aave wbnb entry in registry", () => {
    const entries = lookupRegistry({
      chain: "bnb",
      protocol: "aave",
      symbol: "WBNB"
    });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.address).toBe("0x9B00a09492a626678E5A3009982191586C444Df9");
  });

  test("returns default aave market entries for bnb", () => {
    const entries = getAaveMarketEntries("bnb");
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(entries.some((entry) => entry.symbol === "USDT")).toBe(true);
    expect(entries.some((entry) => entry.symbol === "FDUSD")).toBe(true);
  });

  test("exposes llm manifest and method schema", () => {
    const manifest = getLlmManifest();
    expect(manifest.methods["aave.positions"]).toBeDefined();
    expect(getMethodSchema("registry.lookup")).toBeDefined();
  });
});
