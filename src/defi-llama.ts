/**
 * DeFiLlama protocol lookup fallback.
 *
 * Used when registry.lookup finds no results for a protocol query.
 * Fetches from the public DeFiLlama API (no API key required).
 *
 * Cached in-process for 1 hour.
 */

import type { SupportedChain } from "./types";
import { logger } from "./logger";

type DefiLlamaProtocol = {
  id: string;
  name: string;
  slug: string;
  symbol?: string;
  category?: string;
  chains?: string[];
  tvl?: number;
  description?: string;
  url?: string;
  twitter?: string;
  address?: string | null;
};

// ─── Llama chain name → SupportedChain mapping ───────────────────────────────
const LLAMA_CHAIN_MAP: Record<string, SupportedChain> = {
  ethereum: "ethereum",
  bsc: "bnb",
  bnb: "bnb",
  "bnb chain": "bnb",
  base: "base",
  arbitrum: "arbitrum",
  optimism: "optimism",
  polygon: "polygon"
};

// ─── In-process cache ─────────────────────────────────────────────────────────
let _cachedProtocols: DefiLlamaProtocol[] | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchProtocols(): Promise<DefiLlamaProtocol[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch("https://api.llama.fi/protocols", {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) return [];
    const data = (await response.json()) as DefiLlamaProtocol[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function getProtocols(): Promise<DefiLlamaProtocol[]> {
  if (_cachedProtocols && Date.now() < _cacheExpiresAt) {
    return _cachedProtocols;
  }
  logger.debug("defillama.fetch", { endpoint: "protocols" });
  const protocols = await fetchProtocols();
  if (protocols.length > 0) {
    _cachedProtocols = protocols;
    _cacheExpiresAt = Date.now() + CACHE_TTL_MS;
    logger.info("defillama.loaded", { count: protocols.length });
  }
  return protocols;
}

/** Invalidate the DeFiLlama cache (e.g. for testing) */
export function clearDefiLlamaCache(): void {
  _cachedProtocols = null;
  _cacheExpiresAt = 0;
}

/**
 * Search for protocols by name or slug on DeFiLlama.
 * Optionally filter to protocols that operate on a given chain.
 */
export async function findProtocols(
  query: string,
  chain?: SupportedChain
): Promise<DefiLlamaProtocol[]> {
  const protocols = await getProtocols();
  const needle = query.toLowerCase();

  const matches = protocols.filter((p) => {
    const nameMatch =
      p.name.toLowerCase().includes(needle) ||
      p.slug.toLowerCase().includes(needle) ||
      (p.symbol ?? "").toLowerCase() === needle;
    if (!nameMatch) return false;

    if (chain) {
      const llamaChains = (p.chains ?? []).map((c) => c.toLowerCase());
      const targetLlamaNames = Object.entries(LLAMA_CHAIN_MAP)
        .filter(([, v]) => v === chain)
        .map(([k]) => k);
      return llamaChains.some((c) => targetLlamaNames.includes(c));
    }
    return true;
  });

  // Sort by TVL descending so the most relevant protocol appears first
  return matches.sort((a, b) => (b.tvl ?? 0) - (a.tvl ?? 0)).slice(0, 5);
}

/**
 * Convert a DeFiLlama result to a hint object for registry.lookup response.
 */
export function llamaProtocolToHint(
  p: DefiLlamaProtocol,
  chain?: SupportedChain
): Record<string, unknown> {
  const supportedChains = (p.chains ?? [])
    .map((c) => LLAMA_CHAIN_MAP[c.toLowerCase()])
    .filter(Boolean) as SupportedChain[];

  return {
    name: p.name,
    slug: p.slug,
    symbol: p.symbol ?? null,
    category: p.category ?? null,
    tvl: p.tvl ?? null,
    description: p.description ?? null,
    url: p.url ?? null,
    supportedChains,
    requestedChain: chain ?? null,
    source: "defillama",
    llamaUrl: `https://defillama.com/protocol/${p.slug}`,
    note: "Found on DeFiLlama. Contracts not yet in the AgentRail registry. Use registry.add to register specific contract addresses."
  };
}
