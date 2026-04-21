import type { SupportedChain } from "./types";
import { getEnv } from "./env";

const CHAIN_CONFIG = {
  local: {
    chainId: 31337,
    envVar: "LOCAL_RPC_URL",
    defaultRpcUrls: ["http://127.0.0.1:8545"]
  },
  bnb: {
    chainId: 56,
    envVar: "BNB_RPC_URL",
    defaultRpcUrls: [
      "https://bsc-rpc.publicnode.com",
      "https://bsc-dataseed.binance.org",
      "https://rpc.ankr.com/bsc"
    ]
  },
  ethereum: {
    chainId: 1,
    envVar: "ETHEREUM_RPC_URL",
    defaultRpcUrls: [
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.ankr.com/eth"
    ]
  },
  base: {
    chainId: 8453,
    envVar: "BASE_RPC_URL",
    defaultRpcUrls: [
      "https://mainnet.base.org",
      "https://base-rpc.publicnode.com"
    ]
  },
  arbitrum: {
    chainId: 42161,
    envVar: "ARBITRUM_RPC_URL",
    defaultRpcUrls: [
      "https://arb1.arbitrum.io/rpc",
      "https://arbitrum-one-rpc.publicnode.com"
    ]
  },
  optimism: {
    chainId: 10,
    envVar: "OPTIMISM_RPC_URL",
    defaultRpcUrls: [
      "https://mainnet.optimism.io",
      "https://optimism-rpc.publicnode.com"
    ]
  },
  polygon: {
    chainId: 137,
    envVar: "POLYGON_RPC_URL",
    defaultRpcUrls: [
      "https://polygon-rpc.com",
      "https://polygon-bor-rpc.publicnode.com",
      "https://rpc.ankr.com/polygon"
    ]
  }
} as const satisfies Record<
  SupportedChain,
  { chainId: number; envVar: string; defaultRpcUrls: string[] }
>;

export function getChainConfig(chain: SupportedChain) {
  return CHAIN_CONFIG[chain];
}

export function getRpcUrl(chain: SupportedChain) {
  return getRpcUrls(chain)[0];
}

export function getRpcUrls(chain: SupportedChain) {
  const value = getEnv(getChainConfig(chain).envVar);
  if (value) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [...getChainConfig(chain).defaultRpcUrls];
}

export function getRpcTransportConfig() {
  return {
    retryCount: Number.parseInt(getEnv("AGENTRAIL_RPC_RETRY_COUNT") ?? "2", 10),
    retryDelay: Number.parseInt(getEnv("AGENTRAIL_RPC_RETRY_DELAY_MS") ?? "150", 10),
    timeout: Number.parseInt(getEnv("AGENTRAIL_RPC_TIMEOUT_MS") ?? "10000", 10)
  };
}

export function getHyperliquidConfig() {
  return {
    apiUrl: getEnv("HYPERLIQUID_API_URL") ?? "https://api.hyperliquid.xyz/info",
    exchangeUrl: getEnv("HYPERLIQUID_EXCHANGE_URL") ?? "https://api.hyperliquid.xyz/exchange",
    isMainnet: (getEnv("HYPERLIQUID_IS_MAINNET") ?? "true") !== "false",
    timeout: Number.parseInt(getEnv("AGENTRAIL_HYPERLIQUID_TIMEOUT_MS") ?? "10000", 10)
  };
}
