import { describe, expect, test, beforeEach } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbi } from "viem";
import { buildMinimalAbiFromSignature, normalizeAbiJson, resolveAbi } from "./abi";
import { abiCache, abiNegativeCache, makeAbiCacheKey } from "./cache";
import { AcpError, asError, getErrorAdvice } from "./errors";
import { getLlmManifest, getMethodSchema } from "./manifest";
import { mergePolicy } from "./policy";
import { REGISTRY, getAaveMarketEntries, getCompoundMarkets, lookupRegistry } from "./registry";
import {
  bigintReplacer,
  decodeLogWithAbi,
  formatDisplayValue,
  formatTokenValue,
  listAbiFunctions,
  listAbiEvents,
  normalizeAddress,
  resolveFunction,
  semanticTypeFromInput,
  summarizeFunctionRisk
} from "./utils";
import type { RequestEnvelope } from "./types";
import { nonceManager } from "./nonce";

// ─── Semantic Helpers ─────────────────────────────────────────────────────────

describe("semantic helpers", () => {
  test("maps token-like integers to token_amount", () => {
    expect(semanticTypeFromInput("amount", "uint256")).toBe("token_amount");
    expect(semanticTypeFromInput("assets", "uint256")).toBe("token_amount");
    expect(semanticTypeFromInput("shares", "uint128")).toBe("token_amount");
  });

  test("maps deadline to timestamp", () => {
    expect(semanticTypeFromInput("deadline", "uint256")).toBe("timestamp");
  });

  test("maps plain integer correctly", () => {
    expect(semanticTypeFromInput("count", "uint256")).toBe("integer");
  });

  test("maps receiver/owner/spender to wallet_address", () => {
    expect(semanticTypeFromInput("receiver", "address")).toBe("wallet_address");
    expect(semanticTypeFromInput("owner", "address")).toBe("wallet_address");
    expect(semanticTypeFromInput("spender", "address")).toBe("wallet_address");
  });

  test("maps generic address correctly", () => {
    expect(semanticTypeFromInput("target", "address")).toBe("address");
  });

  test("maps bool correctly", () => {
    expect(semanticTypeFromInput("approved", "bool")).toBe("boolean");
  });

  test("maps bytes types", () => {
    expect(semanticTypeFromInput("data", "bytes")).toBe("bytes");
    expect(semanticTypeFromInput("sig", "bytes32")).toBe("bytes");
  });
});

// ─── Risk Summarization ───────────────────────────────────────────────────────

describe("risk summarization", () => {
  test("flags approve as high risk", () => {
    expect(summarizeFunctionRisk("approve")).toBe("high");
  });

  test("flags setApprovalForAll as high risk", () => {
    expect(summarizeFunctionRisk("setApprovalForAll")).toBe("high");
  });

  test("flags transfer as medium risk", () => {
    expect(summarizeFunctionRisk("transfer")).toBe("medium");
  });

  test("flags deposit as medium risk", () => {
    expect(summarizeFunctionRisk("deposit")).toBe("medium");
  });

  test("flags withdraw as medium risk", () => {
    expect(summarizeFunctionRisk("withdraw")).toBe("medium");
  });

  test("flags mint as medium risk", () => {
    expect(summarizeFunctionRisk("mint")).toBe("medium");
  });

  test("flags burn as medium risk", () => {
    expect(summarizeFunctionRisk("burn")).toBe("medium");
  });

  test("flags balanceOf as low risk", () => {
    expect(summarizeFunctionRisk("balanceOf")).toBe("low");
  });

  test("flags totalSupply as low risk", () => {
    expect(summarizeFunctionRisk("totalSupply")).toBe("low");
  });
});

// ─── ABI Utils ───────────────────────────────────────────────────────────────

describe("ABI utils", () => {
  test("normalizes explorer ABI JSON array", () => {
    const abi = normalizeAbiJson(
      '[{"type":"function","stateMutability":"view","name":"symbol","inputs":[],"outputs":[{"name":"","type":"string"}]}]'
    );
    expect(Array.isArray(abi)).toBe(true);
    expect(abi[0]?.type).toBe("function");
  });

  test("builds minimal ABI from function signature with returns", () => {
    const abi = buildMinimalAbiFromSignature({
      functionSignature: "balanceOf(address)",
      returns: ["uint256"],
      stateMutability: "view"
    });
    expect(Array.isArray(abi)).toBe(true);
    const fn = abi[0];
    expect(fn?.type).toBe("function");
    if (fn?.type === "function") {
      expect(fn.name).toBe("balanceOf");
    }
  });

  test("builds minimal ABI from nonpayable signature", () => {
    const abi = buildMinimalAbiFromSignature({
      functionSignature: "transfer(address,uint256)",
      stateMutability: "nonpayable"
    });
    expect(Array.isArray(abi)).toBe(true);
  });

  test("throws on invalid function signature", () => {
    expect(() =>
      buildMinimalAbiFromSignature({ functionSignature: "not a valid sig !!!" })
    ).toThrow();
  });

  test("listAbiFunctions filters only functions", () => {
    const abi = parseAbi([
      "function balanceOf(address) view returns (uint256)",
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    const fns = listAbiFunctions(abi);
    expect(fns.length).toBe(1);
    expect(fns[0]?.name).toBe("balanceOf");
  });

  test("listAbiEvents filters only events", () => {
    const abi = parseAbi([
      "function balanceOf(address) view returns (uint256)",
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);
    const events = listAbiEvents(abi);
    expect(events.length).toBe(1);
    expect(events[0]?.name).toBe("Transfer");
  });

  test("resolveFunction finds by name", () => {
    const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    const fn = resolveFunction(abi, "balanceOf");
    expect(fn.name).toBe("balanceOf");
  });

  test("resolveFunction finds by full signature", () => {
    const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    const fn = resolveFunction(abi, "balanceOf(address)");
    expect(fn.name).toBe("balanceOf");
  });

  test("resolveFunction throws for unknown function", () => {
    const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    expect(() => resolveFunction(abi, "nonExistentFunction")).toThrow(AcpError);
  });
});

// ─── ABI Resolution (cache-aware) ─────────────────────────────────────────────

describe("ABI resolution", () => {
  test("returns user-supplied ABI immediately", async () => {
    const abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
    const result = await resolveAbi({
      chain: "ethereum",
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      abi,
      loadLocalAbi: async () => { throw new Error("should not call"); }
    });
    expect(result.source).toBe("user-supplied");
    expect(result.abi).toBe(abi);
  });

  test("returns function-signature ABI when no other source", async () => {
    // Pre-seed negative cache so no live network calls are made
    const testAddr = "0x0000000000000000000000000000000000000001";
    abiNegativeCache.set(makeAbiCacheKey("ethereum", testAddr, "sourcify:neg"), true);
    abiNegativeCache.set(makeAbiCacheKey("ethereum", testAddr, "explorer:neg"), true);
    const result = await resolveAbi({
      chain: "ethereum",
      address: testAddr,
      functionSignature: "balanceOf(address)",
      returns: ["uint256"],
      stateMutability: "view",
      loadLocalAbi: async () => { throw new Error("should not call"); }
    });
    expect(result.source).toBe("function-signature");
    expect(result.abi).toBeTruthy();
  });
});

// ─── ABI Cache ────────────────────────────────────────────────────────────────

describe("ABI cache", () => {
  beforeEach(() => {
    abiCache.clear();
    abiNegativeCache.clear();
  });

  test("makeAbiCacheKey is lowercase and deterministic", () => {
    const k1 = makeAbiCacheKey("ethereum", "0xABC", "sourcify");
    const k2 = makeAbiCacheKey("ethereum", "0xabc", "sourcify");
    expect(k1).toBe(k2);
    expect(k1).toBe("ethereum:0xabc:sourcify");
  });

  test("abiCache set and get within TTL", () => {
    abiCache.set("test-key", "test-value");
    expect(abiCache.get("test-key")).toBe("test-value");
  });

  test("abiCache returns undefined for missing key", () => {
    expect(abiCache.get("nonexistent")).toBeUndefined();
  });

  test("abiNegativeCache stores hit markers", () => {
    abiNegativeCache.set("neg-key", true);
    expect(abiNegativeCache.has("neg-key")).toBe(true);
  });

  test("abiCache.size evicts nothing when fresh", () => {
    abiCache.set("a", "1");
    abiCache.set("b", "2");
    expect(abiCache.size).toBe(2);
  });
});

// ─── Policy ───────────────────────────────────────────────────────────────────

describe("policy", () => {
  test("default policy disables writes and requires simulation", () => {
    const policy = mergePolicy();
    expect(policy.allowWrites).toBe(false);
    expect(policy.simulationRequired).toBe(true);
    expect(policy.mode).toBe("safe");
  });

  test("mergePolicy overrides individual fields", () => {
    const policy = mergePolicy({ allowWrites: true });
    expect(policy.allowWrites).toBe(true);
    expect(policy.simulationRequired).toBe(true);
  });

  test("mergePolicy preserves maxValueWei", () => {
    const policy = mergePolicy({ maxValueWei: "1000000000000000000" });
    expect(policy.maxValueWei).toBe("1000000000000000000");
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────

describe("error handling", () => {
  test("AcpError preserves code and message", () => {
    const err = new AcpError("TEST_CODE", "test message", { extra: 1 });
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test message");
    expect((err.data as { extra: number }).extra).toBe(1);
  });

  test("asError wraps plain Error", () => {
    const wrapped = asError(new Error("plain error"));
    expect(wrapped.code).toBe("INTERNAL_ERROR");
    expect(wrapped.message).toBe("plain error");
  });

  test("asError passes through AcpError unchanged", () => {
    const original = new AcpError("CUSTOM", "custom");
    const result = asError(original);
    expect(result).toBe(original);
  });

  test("asError wraps unknown values", () => {
    const wrapped = asError("some string error");
    expect(wrapped.code).toBe("INTERNAL_ERROR");
  });

  test("getErrorAdvice returns retryable advice for ABI_REQUIRED", () => {
    const advice = getErrorAdvice(new AcpError("ABI_REQUIRED", ""));
    expect(advice.retryable).toBe(true);
    expect(advice.suggestedNextActions.length).toBeGreaterThan(0);
  });

  test("getErrorAdvice returns non-retryable for INVALID_ADDRESS", () => {
    const advice = getErrorAdvice(new AcpError("INVALID_ADDRESS", ""));
    expect(advice.retryable).toBe(false);
  });

  test("getErrorAdvice has fallback for unknown codes", () => {
    const advice = getErrorAdvice(new AcpError("UNKNOWN_XYZ", ""));
    expect(advice.retryable).toBe(true);
    expect(advice.likelyCauses.length).toBeGreaterThan(0);
  });
});

// ─── Address Normalization ────────────────────────────────────────────────────

describe("address normalization", () => {
  test("checksums valid address", () => {
    const result = normalizeAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
    expect(result).toBe("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
  });

  test("throws AcpError for invalid address", () => {
    expect(() => normalizeAddress("not-an-address")).toThrow(AcpError);
  });

  test("throws for short address", () => {
    expect(() => normalizeAddress("0x1234")).toThrow(AcpError);
  });
});

// ─── Token Value Formatting ───────────────────────────────────────────────────

describe("formatTokenValue", () => {
  test("formats bigint with 18 decimals", () => {
    expect(formatTokenValue(10003557142776725n, 18)).toBe("0.010003557142776725");
  });

  test("formats bigint with 6 decimals (USDC)", () => {
    expect(formatTokenValue(1000000n, 6)).toBe("1");
  });

  test("formats string integer with decimals", () => {
    expect(formatTokenValue("1000000000000000000", 18)).toBe("1");
  });

  test("returns null when decimals not provided", () => {
    expect(formatTokenValue(1000n, undefined)).toBeNull();
  });

  test("returns null for non-numeric string", () => {
    expect(formatTokenValue("abc", 18)).toBeNull();
  });
});

describe("formatDisplayValue", () => {
  test("formats bigint as string", () => {
    expect(formatDisplayValue(42n)).toBe("42");
  });

  test("formats array as JSON", () => {
    expect(formatDisplayValue([1, 2, 3])).toBe("[1,2,3]");
  });

  test("formats object as JSON", () => {
    expect(formatDisplayValue({ a: 1 })).toBe('{"a":1}');
  });

  test("formats string as-is", () => {
    expect(formatDisplayValue("hello")).toBe("hello");
  });
});

// ─── bigintReplacer ───────────────────────────────────────────────────────────

describe("bigintReplacer", () => {
  test("converts bigint to string", () => {
    const result = JSON.stringify({ value: 123n }, bigintReplacer);
    expect(result).toBe('{"value":"123"}');
  });

  test("passes non-bigint through unchanged", () => {
    const result = JSON.stringify({ a: 1, b: "x" }, bigintReplacer);
    expect(result).toBe('{"a":1,"b":"x"}');
  });
});

// ─── Event Decoding ───────────────────────────────────────────────────────────

describe("event decoding", () => {
  test("decodes ERC20 Transfer event", () => {
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
    const data = encodeAbiParameters([{ type: "uint256" }], [42n]);
    const decoded = decodeLogWithAbi({ abi, data, topics });
    expect(decoded).toBeTruthy();
    expect(String(decoded?.eventName)).toBe("Transfer");
    const args = decoded?.args as { value?: bigint };
    expect(args?.value).toBe(42n);
  });

  test("decodes Approval event", () => {
    const abi = parseAbi([
      "event Approval(address indexed owner, address indexed spender, uint256 value)"
    ]);
    const topics = encodeEventTopics({
      abi,
      eventName: "Approval",
      args: {
        owner: "0x0000000000000000000000000000000000000001",
        spender: "0x0000000000000000000000000000000000000002"
      }
    }).filter(Boolean) as `0x${string}`[];
    const data = encodeAbiParameters([{ type: "uint256" }], [1000n]);
    const decoded = decodeLogWithAbi({ abi, data, topics });
    expect(decoded).toBeTruthy();
    expect(String(decoded?.eventName)).toBe("Approval");
  });

  test("returns null for empty topics", () => {
    const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    const decoded = decodeLogWithAbi({ abi, data: "0x", topics: [] });
    expect(decoded).toBeNull();
  });

  test("returns null for mismatched ABI", () => {
    const abi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    const decoded = decodeLogWithAbi({ abi, data: "0x", topics: ["0xdeadbeef00000000000000000000000000000000000000000000000000000000"] });
    expect(decoded).toBeNull();
  });
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe("registry", () => {
  test("finds Aave WBNB entry on BNB chain", () => {
    const entries = lookupRegistry({ chain: "bnb", protocol: "aave", symbol: "WBNB" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.address).toBe("0x9B00a09492a626678E5A3009982191586C444Df9");
  });

  test("returns all aave market entries for bnb (at least 6)", () => {
    const entries = getAaveMarketEntries("bnb");
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(entries.some((e) => e.symbol === "USDT")).toBe(true);
    expect(entries.some((e) => e.symbol === "FDUSD")).toBe(true);
  });

  test("finds Aave V3 entries on Ethereum", () => {
    const entries = getAaveMarketEntries("ethereum");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.symbol === "WETH")).toBe(true);
    expect(entries.some((e) => e.symbol === "USDC")).toBe(true);
  });

  test("finds Aave V3 entries on Arbitrum", () => {
    const entries = getAaveMarketEntries("arbitrum");
    expect(entries.length).toBeGreaterThan(0);
  });

  test("finds Compound markets on Ethereum", () => {
    const markets = getCompoundMarkets("ethereum");
    expect(markets.length).toBeGreaterThan(0);
    expect(markets.some((m) => m.metadata?.baseToken === "USDC")).toBe(true);
  });

  test("finds Compound markets on Base", () => {
    const markets = getCompoundMarkets("base");
    expect(markets.length).toBeGreaterThan(0);
  });

  test("finds Uniswap V3 Router on Ethereum", () => {
    const entries = lookupRegistry({ chain: "ethereum", protocol: "uniswap", query: "Router" });
    expect(entries.length).toBeGreaterThan(0);
  });

  test("finds WETH token on Ethereum", () => {
    const entries = lookupRegistry({ chain: "ethereum", protocol: "token", symbol: "WETH" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.address).toBe("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2");
  });

  test("finds USDC on Base", () => {
    const entries = lookupRegistry({ chain: "base", symbol: "USDC" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.address).toBeDefined();
  });

  test("finds Lido stETH", () => {
    const entries = lookupRegistry({ chain: "ethereum", protocol: "lido", symbol: "stETH" });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.address).toBe("0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84");
  });

  test("free-text query finds curve pool", () => {
    const entries = lookupRegistry({ chain: "ethereum", query: "3pool" });
    expect(entries.length).toBeGreaterThan(0);
  });

  test("returns empty array for unknown protocol", () => {
    const entries = lookupRegistry({ protocol: "unknown_protocol_xyz" });
    expect(entries).toHaveLength(0);
  });

  test("REGISTRY has > 50 entries", () => {
    expect(REGISTRY.length).toBeGreaterThan(50);
  });

  test("all REGISTRY entries have required fields", () => {
    for (const entry of REGISTRY) {
      expect(entry.chain).toBeDefined();
      expect(entry.protocol).toBeDefined();
      expect(entry.category).toBeDefined();
      expect(entry.name).toBeDefined();
    }
  });
});

// ─── Nonce Manager ────────────────────────────────────────────────────────────

describe("nonceManager", () => {
  const chain = "ethereum" as const;
  const address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;

  beforeEach(() => {
    nonceManager.reset(chain, address);
  });

  test("acquires nonce from fetchNonce on first call", async () => {
    const nonce = await nonceManager.acquire(chain, address, async () => 42);
    expect(nonce).toBe(42);
  });

  test("increments nonce locally on subsequent calls", async () => {
    const n1 = await nonceManager.acquire(chain, address, async () => 10);
    const n2 = await nonceManager.acquire(chain, address, async () => 10);
    const n3 = await nonceManager.acquire(chain, address, async () => 10);
    expect(n1).toBe(10);
    expect(n2).toBe(11);
    expect(n3).toBe(12);
  });

  test("reset clears tracked nonce", async () => {
    await nonceManager.acquire(chain, address, async () => 5);
    nonceManager.reset(chain, address);
    const n = await nonceManager.acquire(chain, address, async () => 99);
    expect(n).toBe(99);
  });

  test("peek returns current tracked nonce", async () => {
    await nonceManager.acquire(chain, address, async () => 7);
    expect(nonceManager.peek(chain, address)).toBe(8);
  });

  test("set forces a specific nonce value", async () => {
    await nonceManager.acquire(chain, address, async () => 1);
    nonceManager.set(chain, address, 50);
    const n = await nonceManager.acquire(chain, address, async () => 0);
    expect(n).toBe(50);
  });
});

// ─── Manifest ─────────────────────────────────────────────────────────────────

describe("manifest", () => {
  test("getLlmManifest exposes all core methods", () => {
    const manifest = getLlmManifest();
    expect(manifest.methods["aave.positions"]).toBeDefined();
    expect(manifest.methods["contract.read"]).toBeDefined();
    expect(manifest.methods["tx.send"]).toBeDefined();
    expect(manifest.methods["registry.lookup"]).toBeDefined();
  });

  test("getMethodSchema returns schema for known method", () => {
    const schema = getMethodSchema("registry.lookup");
    expect(schema).toBeDefined();
    expect(schema?.description).toBeTruthy();
  });

  test("getMethodSchema returns null for unknown method", () => {
    expect(getMethodSchema("nonexistent.method")).toBeNull();
  });

  test("manifest has name and version", () => {
    const manifest = getLlmManifest();
    expect(manifest.name).toBe("AgentRail");
    expect(manifest.version).toBeDefined();
  });
});

// ─── Request Envelope ─────────────────────────────────────────────────────────

describe("request envelope", () => {
  test("supports rpc.discover method", () => {
    const req: RequestEnvelope = { id: "1", method: "rpc.discover", params: {} };
    expect(req.method).toBe("rpc.discover");
  });

  test("supports output filtering paths", () => {
    const req: RequestEnvelope = {
      id: "2",
      method: "token.balance",
      params: { chain: "bnb", token: "0x0", owner: "0x0" },
      output: { paths: ["result.formatted", "result.symbol"] }
    };
    expect(req.output?.paths).toHaveLength(2);
  });

  test("supports output views", () => {
    const req: RequestEnvelope = {
      id: "3",
      method: "aave.positions",
      params: {},
      output: { view: "non-zero-only", limit: 5 }
    };
    expect(req.output?.view).toBe("non-zero-only");
    expect(req.output?.limit).toBe(5);
  });

  test("chains are all valid SupportedChain values", () => {
    const validChains = ["local", "bnb", "ethereum", "base", "arbitrum", "optimism", "polygon"];
    for (const chain of validChains) {
      const req: RequestEnvelope = { method: "contract.read", params: { chain } };
      expect(validChains).toContain((req.params as { chain: string }).chain);
    }
  });
});
