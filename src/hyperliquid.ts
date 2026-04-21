import { encode as encodeMsgPack } from "@msgpack/msgpack";
import { concat, hexToBytes, keccak256, toBytes, toHex } from "viem";
import { getHyperliquidConfig } from "./config";
import { AcpError } from "./errors";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickFirstString(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}

function pickFirstNumberLikeString(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") {
      return String(value);
    }
  }
  return null;
}

export async function hyperliquidInfo<T = unknown>(
  payload: Record<string, unknown>
): Promise<T> {
  const { apiUrl, timeout } = getHyperliquidConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AcpError(
        "HYPERLIQUID_REQUEST_FAILED",
        `Hyperliquid request failed with status ${response.status}.`,
        {
          status: response.status,
          payload
        }
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AcpError) {
      throw error;
    }

    throw new AcpError(
      "HYPERLIQUID_REQUEST_FAILED",
      `Hyperliquid request failed: ${error instanceof Error ? error.message : String(error)}`,
      { payload }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function hyperliquidExchange<T = unknown>(
  payload: Record<string, unknown>
): Promise<T> {
  const { exchangeUrl, timeout } = getHyperliquidConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(exchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AcpError(
        "HYPERLIQUID_REQUEST_FAILED",
        `Hyperliquid exchange request failed with status ${response.status}.`,
        {
          status: response.status,
          payload
        }
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof AcpError) throw error;
    throw new AcpError(
      "HYPERLIQUID_REQUEST_FAILED",
      `Hyperliquid exchange request failed: ${error instanceof Error ? error.message : String(error)}`,
      { payload }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export function summarizeHyperliquidBalance(balance: JsonRecord) {
  const coin =
    pickFirstString(balance, ["coin", "asset", "token", "name"]) ??
    pickFirstString(asRecord(balance["token"]), ["name", "symbol"]) ??
    "unknown";
  const total =
    pickFirstNumberLikeString(balance, ["total", "balance", "sz", "amount"]) ??
    pickFirstNumberLikeString(asRecord(balance["holding"]), ["total", "amount"]);
  const hold = pickFirstNumberLikeString(balance, ["hold", "locked", "reserved"]);

  return {
    coin,
    total,
    hold
  };
}

export function summarizeHyperliquidPerpPosition(position: JsonRecord) {
  const pos = asRecord(position["position"]);
  const source = Object.keys(pos).length > 0 ? pos : position;
  const coin = pickFirstString(source, ["coin"]);
  const size = pickFirstNumberLikeString(source, ["szi", "sz", "size"]);
  const entryPx = pickFirstNumberLikeString(source, ["entryPx", "entryPrice"]);
  const pnl = pickFirstNumberLikeString(source, ["unrealizedPnl", "unrealizedPnL"]);
  const leverage = pickFirstNumberLikeString(asRecord(source["leverage"]), ["value", "type"]);
  const marginMode = pickFirstString(asRecord(source["leverage"]), ["type"]);

  return {
    coin,
    size,
    entryPx,
    pnl,
    leverage,
    marginMode
  };
}

export function summarizeHyperliquidOpenOrder(order: JsonRecord) {
  return {
    coin: pickFirstString(order, ["coin"]),
    side: pickFirstString(order, ["side"]),
    size: pickFirstNumberLikeString(order, ["sz", "origSz"]),
    limitPx: pickFirstNumberLikeString(order, ["limitPx"]),
    orderType: pickFirstString(order, ["orderType"]),
    reduceOnly: Boolean(order["reduceOnly"]),
    status: pickFirstString(order, ["status"]),
    timestamp: typeof order["timestamp"] === "number" ? order["timestamp"] : null
  };
}

export function summarizeHyperliquidHistoricalOrder(entry: JsonRecord) {
  const order = asRecord(entry["order"]);
  const status = asRecord(entry["status"]);
  const source = Object.keys(order).length > 0 ? order : entry;

  return {
    coin: pickFirstString(source, ["coin"]),
    side: pickFirstString(source, ["side"]),
    size: pickFirstNumberLikeString(source, ["sz", "origSz"]),
    limitPx: pickFirstNumberLikeString(source, ["limitPx"]),
    orderType: pickFirstString(source, ["orderType"]),
    status: pickFirstString(status, ["status"]) ?? pickFirstString(entry, ["status"]),
    statusTimestamp:
      typeof status["timestamp"] === "number"
        ? status["timestamp"]
        : typeof entry["statusTimestamp"] === "number"
          ? entry["statusTimestamp"]
          : null
  };
}

export function summarizeHyperliquidFill(fill: JsonRecord) {
  return {
    coin: pickFirstString(fill, ["coin"]),
    side: pickFirstString(fill, ["side"]),
    direction: pickFirstString(fill, ["dir"]),
    size: pickFirstNumberLikeString(fill, ["sz"]),
    price: pickFirstNumberLikeString(fill, ["px"]),
    closedPnl: pickFirstNumberLikeString(fill, ["closedPnl"]),
    fee: pickFirstNumberLikeString(fill, ["fee"]),
    feeToken: pickFirstString(fill, ["feeToken"]),
    time: typeof fill["time"] === "number" ? fill["time"] : null
  };
}

export function summarizeHyperliquidLedgerEntry(entry: JsonRecord) {
  return {
    type:
      pickFirstString(entry, ["type", "delta", "action"]) ??
      pickFirstString(asRecord(entry["delta"]), ["type"]) ??
      "unknown",
    coin: pickFirstString(entry, ["coin", "token"]),
    amount: pickFirstNumberLikeString(entry, ["usdc", "amount", "delta"]),
    hash: pickFirstString(entry, ["hash"]),
    time: typeof entry["time"] === "number" ? entry["time"] : null
  };
}

export function getSpotBalances(spotState: unknown) {
  const state = asRecord(spotState);
  return asArray<JsonRecord>(
    state["balances"] ??
      state["tokenBalances"] ??
      state["spotBalances"] ??
      state["assets"]
  );
}

export function getPerpPositions(perpState: unknown) {
  const state = asRecord(perpState);
  return asArray<JsonRecord>(state["assetPositions"] ?? state["positions"]);
}

export function getMarginSummary(perpState: unknown) {
  const state = asRecord(perpState);
  return asRecord(state["marginSummary"]);
}

export function getPortfolioSummary(portfolio: unknown) {
  return asRecord(portfolio);
}

export async function getHyperliquidMeta() {
  return hyperliquidInfo<Record<string, unknown>>({
    type: "meta"
  });
}

export async function getHyperliquidSpotMeta() {
  return hyperliquidInfo<Record<string, unknown>>({
    type: "spotMeta"
  });
}

export async function getHyperliquidAllMids() {
  return hyperliquidInfo<Record<string, string>>({
    type: "allMids"
  });
}

export async function resolveHyperliquidAsset(market: string) {
  const normalized = market.trim();
  const isSpot = normalized.includes("/");

  if (isSpot) {
    const spotMeta = await getHyperliquidSpotMeta();
    const universe = asArray<JsonRecord>(spotMeta["universe"]);
    const index = universe.findIndex((entry) => pickFirstString(entry, ["name"]) === normalized);
    if (index === -1) {
      throw new AcpError(
        "HYPERLIQUID_INVALID_RESPONSE",
        `Unknown Hyperliquid spot market: ${normalized}.`,
        { market: normalized }
      );
    }

    const entry = universe[index] ?? {};
    return {
      market: normalized,
      marketType: "spot" as const,
      asset: index + 10_000,
      szDecimals:
        typeof entry["szDecimals"] === "number" ? (entry["szDecimals"] as number) : undefined
    };
  }

  const meta = await getHyperliquidMeta();
  const universe = asArray<JsonRecord>(meta["universe"]);
  const index = universe.findIndex((entry) => pickFirstString(entry, ["name"]) === normalized);
  if (index === -1) {
    throw new AcpError(
      "HYPERLIQUID_INVALID_RESPONSE",
      `Unknown Hyperliquid perp market: ${normalized}.`,
      { market: normalized }
    );
  }

  const entry = universe[index] ?? {};
  return {
    market: normalized,
    marketType: "perp" as const,
    asset: index,
    szDecimals:
      typeof entry["szDecimals"] === "number" ? (entry["szDecimals"] as number) : undefined
  };
}

export function inferHyperliquidAggressivePrice(params: {
  side: "buy" | "sell";
  mid?: string | null;
  slippageBps?: number;
}) {
  if (!params.mid) return null;
  const mid = Number(params.mid);
  if (!Number.isFinite(mid) || mid <= 0) return null;
  const slippageBps = params.slippageBps ?? 100;
  const multiplier =
    params.side === "buy"
      ? 1 + slippageBps / 10_000
      : 1 - slippageBps / 10_000;
  return String(mid * multiplier);
}

export function countDecimalPlaces(value: string) {
  const trimmed = value.trim();
  const dotIndex = trimmed.indexOf(".");
  if (dotIndex === -1) return 0;
  return trimmed.length - dotIndex - 1;
}

function encodeNonceBigEndian(nonce: number) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, BigInt(nonce), false);
  return bytes;
}

export function buildHyperliquidL1ActionHash(params: {
  action: Record<string, unknown>;
  nonce: number;
  vaultAddress?: string | null;
  expiresAfter?: number | null;
}) {
  const parts: Uint8Array[] = [];
  parts.push(encodeMsgPack(params.action));
  parts.push(encodeNonceBigEndian(params.nonce));

  if (!params.vaultAddress) {
    parts.push(new Uint8Array([0]));
  } else {
    parts.push(new Uint8Array([1]));
    parts.push(hexToBytes(params.vaultAddress as `0x${string}`));
  }

  if (params.expiresAfter != null) {
    parts.push(new Uint8Array([0]));
    parts.push(encodeNonceBigEndian(params.expiresAfter));
  }

  return keccak256(concat(parts.map((part) => toHex(part))));
}

export function buildHyperliquidL1TypedData(
  connectionId: `0x${string}`,
  isMainnet: boolean
) {
  return {
    domain: {
      chainId: 1337,
      name: "Exchange",
      verifyingContract: "0x0000000000000000000000000000000000000000" as const,
      version: "1"
    },
    types: {
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" }
      ],
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" }
      ]
    },
    primaryType: "Agent" as const,
    message: {
      source: isMainnet ? "a" : "b",
      connectionId
    }
  };
}
