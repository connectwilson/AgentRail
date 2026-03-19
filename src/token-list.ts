/**
 * Token list resolution for unknown symbols.
 *
 * Falls back to the Uniswap default token list when a symbol/name query returns
 * no registry matches. Results are cached in-process for 24 hours.
 *
 * Token list spec: https://tokenlists.org/
 * Source list:     https://tokens.uniswap.org
 */

import type { SupportedChain } from "./types";
import { logger } from "./logger";

// Chain ID → SupportedChain map (inverse of config)
const CHAIN_ID_TO_NAME: Record<number, SupportedChain> = {
  1: "ethereum",
  56: "bnb",
  8453: "base",
  42161: "arbitrum",
  10: "optimism",
  137: "polygon"
};

// ─── Chain ID mapping for token list (some use different IDs) ────────────────
const SUPPORTED_CHAIN_IDS = new Set(Object.keys(CHAIN_ID_TO_NAME).map(Number));

export type TokenListEntry = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
};

type TokenListPayload = {
  tokens: TokenListEntry[];
};

// ─── In-process cache ─────────────────────────────────────────────────────────
let _cachedTokens: TokenListEntry[] | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const TOKEN_LIST_URLS = [
  "https://tokens.uniswap.org",
  "https://gateway.ipfs.io/ipns/tokens.uniswap.org"
];

async function fetchTokenList(): Promise<TokenListEntry[]> {
  for (const url of TOKEN_LIST_URLS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) continue;
      const payload = (await response.json()) as TokenListPayload;
      if (!Array.isArray(payload.tokens)) continue;
      // Only keep tokens on our supported chains
      return payload.tokens.filter((t) => SUPPORTED_CHAIN_IDS.has(t.chainId));
    } catch {
      continue;
    }
  }
  return [];
}

async function getTokenList(): Promise<TokenListEntry[]> {
  if (_cachedTokens && Date.now() < _cacheExpiresAt) {
    return _cachedTokens;
  }
  logger.debug("token-list.fetch", { source: "uniswap" });
  const tokens = await fetchTokenList();
  if (tokens.length > 0) {
    _cachedTokens = tokens;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    logger.info("token-list.loaded", { count: tokens.length });
  }
  return tokens;
}

/** Invalidate the token list cache (e.g. for testing) */
export function clearTokenListCache(): void {
  _cachedTokens = null;
  _cacheExpiresAt = 0;
}

/**
 * Find tokens by symbol from the Uniswap token list.
 * Returns matches on the given chain (or all chains if not specified).
 */
export async function findTokensBySymbol(
  symbol: string,
  chain?: SupportedChain
): Promise<TokenListEntry[]> {
  const tokens = await getTokenList();
  const needle = symbol.toLowerCase();
  return tokens.filter((t) => {
    if (t.symbol.toLowerCase() !== needle) return false;
    if (chain) {
      const tokenChain = CHAIN_ID_TO_NAME[t.chainId];
      return tokenChain === chain;
    }
    return true;
  });
}

/**
 * Find tokens by name (partial match) from the Uniswap token list.
 */
export async function findTokensByName(
  name: string,
  chain?: SupportedChain
): Promise<TokenListEntry[]> {
  const tokens = await getTokenList();
  const needle = name.toLowerCase();
  return tokens.filter((t) => {
    if (!t.name.toLowerCase().includes(needle)) return false;
    if (chain) {
      const tokenChain = CHAIN_ID_TO_NAME[t.chainId];
      return tokenChain === chain;
    }
    return true;
  });
}

/**
 * Convert a TokenListEntry to a registry-compatible shape for display.
 */
export function tokenListEntryToHint(entry: TokenListEntry): Record<string, unknown> {
  return {
    address: entry.address,
    name: entry.name,
    symbol: entry.symbol,
    decimals: entry.decimals,
    chain: CHAIN_ID_TO_NAME[entry.chainId] ?? `chainId:${entry.chainId}`,
    source: "uniswap-token-list",
    note: "Found in Uniswap token list. Not yet in the AgentRail registry — use registry.add to register permanently."
  };
}
