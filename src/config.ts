import type { SupportedChain } from "./types";
import { getEnv } from "./env";

const CHAIN_CONFIG = {
  local: {
    chainId: 31337,
    envVar: "LOCAL_RPC_URL",
    defaultRpcUrl: "http://127.0.0.1:8545"
  },
  bnb: {
    chainId: 56,
    envVar: "BNB_RPC_URL",
    defaultRpcUrl: "https://bsc-rpc.publicnode.com"
  },
  ethereum: {
    chainId: 1,
    envVar: "ETHEREUM_RPC_URL",
    defaultRpcUrl: "https://ethereum-rpc.publicnode.com"
  },
  base: {
    chainId: 8453,
    envVar: "BASE_RPC_URL",
    defaultRpcUrl: "https://mainnet.base.org"
  },
  arbitrum: {
    chainId: 42161,
    envVar: "ARBITRUM_RPC_URL",
    defaultRpcUrl: "https://arb1.arbitrum.io/rpc"
  },
  optimism: {
    chainId: 10,
    envVar: "OPTIMISM_RPC_URL",
    defaultRpcUrl: "https://mainnet.optimism.io"
  },
  polygon: {
    chainId: 137,
    envVar: "POLYGON_RPC_URL",
    defaultRpcUrl: "https://polygon-rpc.com"
  }
} as const satisfies Record<
  SupportedChain,
  { chainId: number; envVar: string; defaultRpcUrl: string }
>;

export function getChainConfig(chain: SupportedChain) {
  return CHAIN_CONFIG[chain];
}

export function getRpcUrl(chain: SupportedChain) {
  const value = getEnv(getChainConfig(chain).envVar);
  return value ?? getChainConfig(chain).defaultRpcUrl;
}
