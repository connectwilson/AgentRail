import type { SupportedChain } from "./types";

export type RegistryEntry = {
  chain: SupportedChain;
  protocol: string;
  category: "token" | "protocol" | "market" | "contract";
  name: string;
  symbol?: string;
  address?: string;
  metadata?: Record<string, unknown>;
};

export const REGISTRY: RegistryEntry[] = [
  {
    chain: "ethereum",
    protocol: "uniswap",
    category: "contract",
    name: "Uniswap V3 Nonfungible Position Manager",
    address: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
    metadata: { version: "v3" }
  },
  {
    chain: "ethereum",
    protocol: "token",
    category: "token",
    name: "Wrapped Ether",
    symbol: "WETH",
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    metadata: { decimals: 18 }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain CAKE Supply",
    symbol: "CAKE",
    address: "0x4199CC1F5ed0d796563d7CcB2e036253E2C18281",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "CAKE",
      underlyingAddress: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain WBNB Supply",
    symbol: "WBNB",
    address: "0x9B00a09492a626678E5A3009982191586C444Df9",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "WBNB",
      underlyingAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain BTCB Supply",
    symbol: "BTCB",
    address: "0x56a7ddc4e848EbF43845854205ad71D5D5F72d3D",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "BTCB",
      underlyingAddress: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain ETH Supply",
    symbol: "ETH",
    address: "0x2E94171493fAbE316b6205f1585779C887771E2F",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "ETH",
      underlyingAddress: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain USDC Supply",
    symbol: "USDC",
    address: "0x00901a076785e0906d1028c7d6372d247bec7d61",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "USDC",
      underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain USDT Supply",
    symbol: "USDT",
    address: "0xa9251ca9DE909CB71783723713B21E4233fbf1B1",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "USDT",
      underlyingAddress: "0x55d398326f99059fF775485246999027B3197955",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "market",
    name: "Aave V3 BNB Chain FDUSD Supply",
    symbol: "FDUSD",
    address: "0x75bd1A659bdC62e4C313950d44A2416faB43E785",
    metadata: {
      type: "aToken",
      market: "Aave V3 BNB Chain",
      assetSymbol: "FDUSD",
      underlyingAddress: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409",
      decimals: 18
    }
  },
  {
    chain: "bnb",
    protocol: "aave",
    category: "protocol",
    name: "Aave V3 BNB Chain",
    metadata: {
      market: "Aave V3 BNB Chain",
      poolAddress: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
      dataProviderAddress: "0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328",
      supportedAssets: ["CAKE", "WBNB", "BTCB", "ETH", "USDC", "USDT", "FDUSD"]
    }
  }
];

export function lookupRegistry(params: {
  chain?: SupportedChain;
  protocol?: string;
  category?: "token" | "protocol" | "market" | "contract";
  symbol?: string;
  name?: string;
  query?: string;
}) {
  const query = params.query?.toLowerCase();
  const symbol = params.symbol?.toLowerCase();
  const name = params.name?.toLowerCase();
  const protocol = params.protocol?.toLowerCase();

  return REGISTRY.filter((entry) => {
    if (params.chain && entry.chain !== params.chain) {
      return false;
    }
    if (params.category && entry.category !== params.category) {
      return false;
    }
    if (protocol && entry.protocol.toLowerCase() !== protocol) {
      return false;
    }
    if (symbol && entry.symbol?.toLowerCase() !== symbol) {
      return false;
    }
    if (name && !entry.name.toLowerCase().includes(name)) {
      return false;
    }
    if (query) {
      const haystack = [
        entry.protocol,
        entry.category,
        entry.name,
        entry.symbol ?? "",
        entry.address ?? ""
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    }
    return true;
  });
}

export function getAaveMarketEntries(chain: SupportedChain) {
  return REGISTRY.filter(
    (entry) => entry.chain === chain && entry.protocol === "aave" && entry.category === "market"
  );
}
