import { readFileSync, existsSync } from "node:fs";
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

// Internal mutable registry — built-in entries + runtime additions + external file entries
const _registryEntries: RegistryEntry[] = [];

/**
 * Add one or more entries to the registry at runtime.
 * Useful for integrating project-specific contracts without modifying source.
 *
 * @example
 * ```ts
 * import { addRegistryEntries } from "agentrail/sdk";
 * addRegistryEntries([{
 *   chain: "ethereum",
 *   protocol: "myproject",
 *   category: "contract",
 *   name: "My Vault",
 *   address: "0x..."
 * }]);
 * ```
 */
export function addRegistryEntries(entries: RegistryEntry[]): void {
  _registryEntries.push(...entries);
}

/**
 * Remove all runtime-added entries (does not affect built-in entries).
 * Resets to built-in + external file state.
 */
export function resetRegistry(): void {
  _registryEntries.splice(0, _registryEntries.length, ...BUILTIN_REGISTRY);
  _loadExternalFile();
}

/** Read-only view of the full registry (built-in + external + runtime). */
export const REGISTRY = new Proxy(_registryEntries, {
  get(target, prop) {
    return (target as never)[prop as never];
  }
}) as readonly RegistryEntry[];

const BUILTIN_REGISTRY: RegistryEntry[] = [
  // ─── Major Tokens ────────────────────────────────────────────────────────────

  // Ethereum
  { chain: "ethereum", protocol: "token", category: "token", name: "Wrapped Ether", symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "USD Coin", symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", metadata: { decimals: 6 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Tether USD", symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", metadata: { decimals: 6 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Wrapped Bitcoin", symbol: "WBTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", metadata: { decimals: 8 } },

  // BNB Chain
  { chain: "bnb", protocol: "token", category: "token", name: "Wrapped BNB", symbol: "WBNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", metadata: { decimals: 18 } },
  { chain: "bnb", protocol: "token", category: "token", name: "USD Coin", symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", metadata: { decimals: 18 } },
  { chain: "bnb", protocol: "token", category: "token", name: "Tether USD", symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", metadata: { decimals: 18 } },
  { chain: "bnb", protocol: "token", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", metadata: { decimals: 18 } },
  { chain: "bnb", protocol: "token", category: "token", name: "Ethereum Token", symbol: "ETH", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", metadata: { decimals: 18 } },
  { chain: "bnb", protocol: "token", category: "token", name: "Bitcoin BEP2", symbol: "BTCB", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", metadata: { decimals: 18 } },

  // Base
  { chain: "base", protocol: "token", category: "token", name: "Wrapped Ether", symbol: "WETH", address: "0x4200000000000000000000000000000000000006", metadata: { decimals: 18 } },
  { chain: "base", protocol: "token", category: "token", name: "USD Coin", symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", metadata: { decimals: 6 } },
  { chain: "base", protocol: "token", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", metadata: { decimals: 18 } },

  // Arbitrum
  { chain: "arbitrum", protocol: "token", category: "token", name: "Wrapped Ether", symbol: "WETH", address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "token", category: "token", name: "USD Coin", symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", metadata: { decimals: 6 } },
  { chain: "arbitrum", protocol: "token", category: "token", name: "Tether USD", symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", metadata: { decimals: 6 } },
  { chain: "arbitrum", protocol: "token", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "token", category: "token", name: "Wrapped Bitcoin", symbol: "WBTC", address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", metadata: { decimals: 8 } },
  { chain: "arbitrum", protocol: "token", category: "token", name: "Arbitrum", symbol: "ARB", address: "0x912CE59144191C1204E64559FE8253a0e49E6548", metadata: { decimals: 18 } },

  // Optimism
  { chain: "optimism", protocol: "token", category: "token", name: "Wrapped Ether", symbol: "WETH", address: "0x4200000000000000000000000000000000000006", metadata: { decimals: 18 } },
  { chain: "optimism", protocol: "token", category: "token", name: "USD Coin", symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", metadata: { decimals: 6 } },
  { chain: "optimism", protocol: "token", category: "token", name: "Tether USD", symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", metadata: { decimals: 6 } },
  { chain: "optimism", protocol: "token", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", metadata: { decimals: 18 } },
  { chain: "optimism", protocol: "token", category: "token", name: "Optimism", symbol: "OP", address: "0x4200000000000000000000000000000000000042", metadata: { decimals: 18 } },

  // Polygon
  { chain: "polygon", protocol: "token", category: "token", name: "Wrapped Matic", symbol: "WMATIC", address: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", metadata: { decimals: 18 } },
  { chain: "polygon", protocol: "token", category: "token", name: "USD Coin", symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", metadata: { decimals: 6 } },
  { chain: "polygon", protocol: "token", category: "token", name: "Tether USD", symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", metadata: { decimals: 6 } },
  { chain: "polygon", protocol: "token", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", metadata: { decimals: 18 } },
  { chain: "polygon", protocol: "token", category: "token", name: "Wrapped Ether", symbol: "WETH", address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", metadata: { decimals: 18 } },

  // ─── Aave V3 – BNB Chain ─────────────────────────────────────────────────────
  { chain: "bnb", protocol: "aave", category: "protocol", name: "Aave V3 BNB Chain", metadata: { version: "v3", poolAddress: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB", dataProviderAddress: "0xc90Df74A7c16245c5F5C5870327Ceb38Fe5d5328", supportedAssets: ["CAKE", "WBNB", "BTCB", "ETH", "USDC", "USDT", "FDUSD"] } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain CAKE Supply", symbol: "CAKE", address: "0x4199CC1F5ed0d796563d7CcB2e036253E2C18281", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "CAKE", underlyingAddress: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain WBNB Supply", symbol: "WBNB", address: "0x9B00a09492a626678E5A3009982191586C444Df9", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "WBNB", underlyingAddress: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18 } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain BTCB Supply", symbol: "BTCB", address: "0x56a7ddc4e848EbF43845854205ad71D5D5F72d3D", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "BTCB", underlyingAddress: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain ETH Supply", symbol: "ETH", address: "0x2E94171493fAbE316b6205f1585779C887771E2F", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "ETH", underlyingAddress: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain USDC Supply", symbol: "USDC", address: "0x00901a076785e0906d1028c7d6372d247bec7d61", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "USDC", underlyingAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain USDT Supply", symbol: "USDT", address: "0xa9251ca9DE909CB71783723713B21E4233fbf1B1", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "USDT", underlyingAddress: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 } },
  { chain: "bnb", protocol: "aave", category: "market", name: "Aave V3 BNB Chain FDUSD Supply", symbol: "FDUSD", address: "0x75bd1A659bdC62e4C313950d44A2416faB43E785", metadata: { type: "aToken", market: "Aave V3 BNB Chain", assetSymbol: "FDUSD", underlyingAddress: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", decimals: 18 } },

  // ─── Aave V3 – Ethereum ──────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "aave", category: "protocol", name: "Aave V3 Ethereum", metadata: { version: "v3", poolAddress: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", dataProviderAddress: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3", supportedAssets: ["WETH", "WBTC", "USDC", "USDT", "DAI", "LINK", "AAVE", "wstETH", "cbETH", "rETH", "LUSD", "CRV", "MKR", "SNX", "BAL", "UNI", "LDO", "ENS", "1INCH"] } },
  { chain: "ethereum", protocol: "aave", category: "market", name: "Aave V3 Ethereum WETH Supply", symbol: "WETH", address: "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8", metadata: { type: "aToken", market: "Aave V3 Ethereum", assetSymbol: "WETH", underlyingAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 } },
  { chain: "ethereum", protocol: "aave", category: "market", name: "Aave V3 Ethereum WBTC Supply", symbol: "WBTC", address: "0x5Ee5bf7ae06D1Be5997A1A72006FE6C607eC6DE8", metadata: { type: "aToken", market: "Aave V3 Ethereum", assetSymbol: "WBTC", underlyingAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8 } },
  { chain: "ethereum", protocol: "aave", category: "market", name: "Aave V3 Ethereum USDC Supply", symbol: "USDC", address: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c", metadata: { type: "aToken", market: "Aave V3 Ethereum", assetSymbol: "USDC", underlyingAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 } },
  { chain: "ethereum", protocol: "aave", category: "market", name: "Aave V3 Ethereum USDT Supply", symbol: "USDT", address: "0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a", metadata: { type: "aToken", market: "Aave V3 Ethereum", assetSymbol: "USDT", underlyingAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 } },
  { chain: "ethereum", protocol: "aave", category: "market", name: "Aave V3 Ethereum DAI Supply", symbol: "DAI", address: "0x018008bfb33d285247A21d44E50697654f754e63", metadata: { type: "aToken", market: "Aave V3 Ethereum", assetSymbol: "DAI", underlyingAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 } },

  // ─── Aave V3 – Arbitrum ──────────────────────────────────────────────────────
  { chain: "arbitrum", protocol: "aave", category: "protocol", name: "Aave V3 Arbitrum", metadata: { version: "v3", poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", dataProviderAddress: "0x6b4E260b765B3cA1514e618C0215A6B7839fF93e", supportedAssets: ["WETH", "WBTC", "USDC", "USDT", "DAI", "LINK", "AAVE", "ARB"] } },
  { chain: "arbitrum", protocol: "aave", category: "market", name: "Aave V3 Arbitrum WETH Supply", symbol: "WETH", address: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8", metadata: { type: "aToken", market: "Aave V3 Arbitrum", assetSymbol: "WETH", underlyingAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 } },
  { chain: "arbitrum", protocol: "aave", category: "market", name: "Aave V3 Arbitrum USDC Supply", symbol: "USDC", address: "0x724dc807b04555b71ed48a6896b6F41593b8C637", metadata: { type: "aToken", market: "Aave V3 Arbitrum", assetSymbol: "USDC", underlyingAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 } },
  { chain: "arbitrum", protocol: "aave", category: "market", name: "Aave V3 Arbitrum USDT Supply", symbol: "USDT", address: "0x6ab707Aca953eDAefBc4fD23bA73294241490620", metadata: { type: "aToken", market: "Aave V3 Arbitrum", assetSymbol: "USDT", underlyingAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 } },
  { chain: "arbitrum", protocol: "aave", category: "market", name: "Aave V3 Arbitrum DAI Supply", symbol: "DAI", address: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE", metadata: { type: "aToken", market: "Aave V3 Arbitrum", assetSymbol: "DAI", underlyingAddress: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 } },

  // ─── Aave V3 – Base ──────────────────────────────────────────────────────────
  { chain: "base", protocol: "aave", category: "protocol", name: "Aave V3 Base", metadata: { version: "v3", poolAddress: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", dataProviderAddress: "0x2d8A3C5677189723C4cB8873CfC9C8976ddf54D8", supportedAssets: ["WETH", "USDC", "cbETH", "wstETH"] } },
  { chain: "base", protocol: "aave", category: "market", name: "Aave V3 Base WETH Supply", symbol: "WETH", address: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7", metadata: { type: "aToken", market: "Aave V3 Base", assetSymbol: "WETH", underlyingAddress: "0x4200000000000000000000000000000000000006", decimals: 18 } },
  { chain: "base", protocol: "aave", category: "market", name: "Aave V3 Base USDC Supply", symbol: "USDC", address: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB", metadata: { type: "aToken", market: "Aave V3 Base", assetSymbol: "USDC", underlyingAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 } },

  // ─── Aave V3 – Optimism ──────────────────────────────────────────────────────
  { chain: "optimism", protocol: "aave", category: "protocol", name: "Aave V3 Optimism", metadata: { version: "v3", poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", dataProviderAddress: "0x7F23D86Ee20D869112572136221e173428DD740B", supportedAssets: ["WETH", "USDC", "USDT", "DAI", "WBTC", "OP"] } },
  { chain: "optimism", protocol: "aave", category: "market", name: "Aave V3 Optimism WETH Supply", symbol: "WETH", address: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8", metadata: { type: "aToken", market: "Aave V3 Optimism", assetSymbol: "WETH", underlyingAddress: "0x4200000000000000000000000000000000000006", decimals: 18 } },
  { chain: "optimism", protocol: "aave", category: "market", name: "Aave V3 Optimism USDC Supply", symbol: "USDC", address: "0x625E7708f30cA75bfd92586e17077590C60eb4cD", metadata: { type: "aToken", market: "Aave V3 Optimism", assetSymbol: "USDC", underlyingAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 } },
  { chain: "optimism", protocol: "aave", category: "market", name: "Aave V3 Optimism DAI Supply", symbol: "DAI", address: "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE", metadata: { type: "aToken", market: "Aave V3 Optimism", assetSymbol: "DAI", underlyingAddress: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18 } },

  // ─── Aave V3 – Polygon ───────────────────────────────────────────────────────
  { chain: "polygon", protocol: "aave", category: "protocol", name: "Aave V3 Polygon", metadata: { version: "v3", poolAddress: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", dataProviderAddress: "0x9441B65EE553F70df9C77d45d3283B6BC24F222d", supportedAssets: ["WETH", "USDC", "USDT", "DAI", "WBTC", "WMATIC", "AAVE"] } },
  { chain: "polygon", protocol: "aave", category: "market", name: "Aave V3 Polygon WETH Supply", symbol: "WETH", address: "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8", metadata: { type: "aToken", market: "Aave V3 Polygon", assetSymbol: "WETH", underlyingAddress: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 } },
  { chain: "polygon", protocol: "aave", category: "market", name: "Aave V3 Polygon USDC Supply", symbol: "USDC", address: "0x625E7708f30cA75bfd92586e17077590C60eb4cD", metadata: { type: "aToken", market: "Aave V3 Polygon", assetSymbol: "USDC", underlyingAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 } },
  { chain: "polygon", protocol: "aave", category: "market", name: "Aave V3 Polygon WMATIC Supply", symbol: "WMATIC", address: "0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97", metadata: { type: "aToken", market: "Aave V3 Polygon", assetSymbol: "WMATIC", underlyingAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", decimals: 18 } },

  // ─── Uniswap V3 ──────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Router", address: "0xE592427A0AEce92De3Edee1F18E0157C05861564", metadata: { version: "v3", role: "SwapRouter" } },
  { chain: "ethereum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Router 2", address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", metadata: { version: "v3", role: "SwapRouter02" } },
  { chain: "ethereum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Factory", address: "0x1F98431c8aD98523631AE4a59f267346ea31F984", metadata: { version: "v3", role: "Factory" } },
  { chain: "ethereum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Nonfungible Position Manager", address: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88", metadata: { version: "v3", role: "NonfungiblePositionManager" } },
  { chain: "ethereum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Quoter V2", address: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", metadata: { version: "v3", role: "QuoterV2" } },

  { chain: "arbitrum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Router 2", address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", metadata: { version: "v3", role: "SwapRouter02" } },
  { chain: "arbitrum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Quoter V2", address: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", metadata: { version: "v3", role: "QuoterV2" } },
  { chain: "arbitrum", protocol: "uniswap", category: "contract", name: "Uniswap V3 Factory", address: "0x1F98431c8aD98523631AE4a59f267346ea31F984", metadata: { version: "v3", role: "Factory" } },

  { chain: "base", protocol: "uniswap", category: "contract", name: "Uniswap V3 Router 2", address: "0x2626664c2603336E57B271c5C0b26F421741e481", metadata: { version: "v3", role: "SwapRouter02" } },
  { chain: "base", protocol: "uniswap", category: "contract", name: "Uniswap V3 Quoter V2", address: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a", metadata: { version: "v3", role: "QuoterV2" } },

  { chain: "optimism", protocol: "uniswap", category: "contract", name: "Uniswap V3 Router 2", address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", metadata: { version: "v3", role: "SwapRouter02" } },
  { chain: "optimism", protocol: "uniswap", category: "contract", name: "Uniswap V3 Quoter V2", address: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", metadata: { version: "v3", role: "QuoterV2" } },

  { chain: "polygon", protocol: "uniswap", category: "contract", name: "Uniswap V3 Router 2", address: "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", metadata: { version: "v3", role: "SwapRouter02" } },
  { chain: "polygon", protocol: "uniswap", category: "contract", name: "Uniswap V3 Quoter V2", address: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e", metadata: { version: "v3", role: "QuoterV2" } },

  // ─── Compound V3 (Comet) ─────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "compound", category: "protocol", name: "Compound V3 ETH USDC Market", address: "0xc3d688B66703497DAA19211EEdff47f25384cdc3", metadata: { version: "v3", baseToken: "USDC", baseTokenDecimals: 6, role: "Comet" } },
  { chain: "ethereum", protocol: "compound", category: "protocol", name: "Compound V3 ETH WETH Market", address: "0xA17581A9E3356d9a858b789D68B4d866e593aE94", metadata: { version: "v3", baseToken: "WETH", baseTokenDecimals: 18, role: "Comet" } },
  { chain: "arbitrum", protocol: "compound", category: "protocol", name: "Compound V3 Arbitrum USDC Market", address: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", metadata: { version: "v3", baseToken: "USDC", baseTokenDecimals: 6, role: "Comet" } },
  { chain: "base", protocol: "compound", category: "protocol", name: "Compound V3 Base USDC Market", address: "0xb125E6687d4313864e53df431d5425969c15Eb2F", metadata: { version: "v3", baseToken: "USDC", baseTokenDecimals: 6, role: "Comet" } },
  { chain: "base", protocol: "compound", category: "protocol", name: "Compound V3 Base USDbC Market", address: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", metadata: { version: "v3", baseToken: "USDbC", baseTokenDecimals: 6, role: "Comet" } },
  { chain: "polygon", protocol: "compound", category: "protocol", name: "Compound V3 Polygon USDC Market", address: "0xF25212E676D1F7F89Cd72fFEe66158f541246445", metadata: { version: "v3", baseToken: "USDC", baseTokenDecimals: 6, role: "Comet" } },

  // ─── Curve ───────────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "curve", category: "contract", name: "Curve Address Provider", address: "0x0000000022D53366457F9d5E68Ec105046FC4383", metadata: { role: "AddressProvider" } },
  { chain: "ethereum", protocol: "curve", category: "contract", name: "Curve Router", address: "0xF0d4c12A5768D806021F80a262B4d39d26C58b8D", metadata: { role: "Router" } },
  { chain: "ethereum", protocol: "curve", category: "contract", name: "Curve 3Pool (DAI/USDC/USDT)", address: "0xbEbc44782C7dB0a1A60Cb6fe97d0b483032FF1C7", metadata: { role: "StableSwapPool", coins: ["DAI", "USDC", "USDT"] } },
  { chain: "ethereum", protocol: "curve", category: "contract", name: "Curve stETH Pool", address: "0xDC24316b9AE028F1497c275EB9192a3Ea0f67022", metadata: { role: "StableSwapPool", coins: ["ETH", "stETH"] } },

  // ─── Lido ─────────────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "lido", category: "contract", name: "Lido stETH", symbol: "stETH", address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", metadata: { decimals: 18, role: "LiquidStakingToken" } },
  { chain: "ethereum", protocol: "lido", category: "contract", name: "Lido wstETH", symbol: "wstETH", address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", metadata: { decimals: 18, role: "WrappedStakingToken" } },
  { chain: "ethereum", protocol: "lido", category: "contract", name: "Lido Staking Router", address: "0xFdDf38947aFB03C621203b9AC652eC6cD37BbDd3", metadata: { role: "StakingRouter" } },

  // ─── Frax ─────────────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "frax", category: "token", name: "Frax", symbol: "FRAX", address: "0x853d955aCEf822Db058eb8505911ED77F175b99e", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "frax", category: "token", name: "Frax Share", symbol: "FXS", address: "0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "frax", category: "contract", name: "Frax Staked Ether", symbol: "sfrxETH", address: "0xac3E018457B222d93114458476f3E3416Abbe38F", metadata: { decimals: 18, role: "ERC4626Vault" } },
  { chain: "ethereum", protocol: "frax", category: "contract", name: "Frax Ether", symbol: "frxETH", address: "0x5E8422345238F34275888049021821E8E08CAa1f", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "frax", category: "contract", name: "Frax ETH Minter", address: "0xbAFA44EFE7901E04E39Dad13167D089C559c1138", metadata: { role: "frxETHMinter" } },
  { chain: "arbitrum", protocol: "frax", category: "token", name: "Frax", symbol: "FRAX", address: "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F", metadata: { decimals: 18 } },
  { chain: "polygon", protocol: "frax", category: "token", name: "Frax", symbol: "FRAX", address: "0x45c32fA6DF82ead1e2EF74d17b76547EDdFaFF89", metadata: { decimals: 18 } },

  // ─── Balancer ─────────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "balancer", category: "protocol", name: "Balancer V2 Vault", address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8", metadata: { version: "v2", role: "Vault" } },
  { chain: "ethereum", protocol: "balancer", category: "contract", name: "Balancer Weighted Pool Factory", address: "0x897888115Ada5773E02aA29F775430BFB5F34c51", metadata: { version: "v2", role: "WeightedPoolFactory" } },
  { chain: "ethereum", protocol: "balancer", category: "token", name: "Balancer", symbol: "BAL", address: "0xba100000625a3754423978a60c9317c58a424e3D", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "balancer", category: "token", name: "Balancer Staked Token", symbol: "stkAave", address: "0x4da27a545c0c5B758a6BA100e3a049001de870f5", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "balancer", category: "protocol", name: "Balancer V2 Vault", address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8", metadata: { version: "v2", role: "Vault" } },
  { chain: "arbitrum", protocol: "balancer", category: "token", name: "Balancer", symbol: "BAL", address: "0x040d1EdC9569d4Bab2D15287Dc5A4F10F56a56B8", metadata: { decimals: 18 } },
  { chain: "base", protocol: "balancer", category: "protocol", name: "Balancer V2 Vault", address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8", metadata: { version: "v2", role: "Vault" } },
  { chain: "polygon", protocol: "balancer", category: "protocol", name: "Balancer V2 Vault", address: "0xBA12222222228d8Ba445958a75a0704d566BF2C8", metadata: { version: "v2", role: "Vault" } },
  { chain: "polygon", protocol: "balancer", category: "token", name: "Balancer", symbol: "BAL", address: "0x9a71012B13CA4d3D0Cdc72A177DF3ef03b0E76A3", metadata: { decimals: 18 } },

  // ─── GMX ──────────────────────────────────────────────────────────────────────
  { chain: "arbitrum", protocol: "gmx", category: "protocol", name: "GMX Router", address: "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064", metadata: { version: "v1", role: "Router" } },
  { chain: "arbitrum", protocol: "gmx", category: "protocol", name: "GMX Vault", address: "0x489ee077994B6658eAfA855C308275EAd8097C4A", metadata: { version: "v1", role: "Vault" } },
  { chain: "arbitrum", protocol: "gmx", category: "protocol", name: "GMX V2 Exchange Router", address: "0x7C68C7866A64FA2160F78EEaE12217FFbf871fa8", metadata: { version: "v2", role: "ExchangeRouter" } },
  { chain: "arbitrum", protocol: "gmx", category: "token", name: "GMX", symbol: "GMX", address: "0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "gmx", category: "token", name: "Escrowed GMX", symbol: "esGMX", address: "0xf42Ae1D54fd613C9bb14810b0588FaAa09a426cA", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "gmx", category: "token", name: "GMX Liquidity Provider", symbol: "GLP", address: "0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258", metadata: { decimals: 18 } },

  // ─── MakerDAO / Sky ───────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "maker", category: "token", name: "Maker", symbol: "MKR", address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "maker", category: "token", name: "Dai Stablecoin", symbol: "DAI", address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "maker", category: "contract", name: "MakerDAO Dai Savings Rate (DSR) Pot", address: "0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7", metadata: { role: "DSR_Pot" } },
  { chain: "ethereum", protocol: "maker", category: "contract", name: "MakerDAO CDP Manager", address: "0x5ef30b9986345249bc32d8928B7ee64DE9435E39", metadata: { role: "CDPManager" } },
  { chain: "ethereum", protocol: "maker", category: "contract", name: "sDAI (ERC4626 DSR Wrapper)", symbol: "sDAI", address: "0x83F20F44975D03b1b09e64809B757c47f942BEeA", metadata: { decimals: 18, role: "ERC4626_DSR" } },

  // ─── Rocket Pool ──────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "rocketpool", category: "token", name: "Rocket Pool ETH", symbol: "rETH", address: "0xae78736Cd615f374D3085123A210448E74Fc6393", metadata: { decimals: 18, role: "LiquidStakingToken" } },
  { chain: "ethereum", protocol: "rocketpool", category: "contract", name: "Rocket Pool Storage", address: "0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46", metadata: { role: "RocketStorage" } },
  { chain: "ethereum", protocol: "rocketpool", category: "contract", name: "Rocket Deposit Pool", address: "0xDD3f50F8A6CafbE9b31a427582963f465E745AF8", metadata: { role: "RocketDepositPool" } },

  // ─── Convex Finance ───────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "convex", category: "token", name: "Convex Token", symbol: "CVX", address: "0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "convex", category: "token", name: "Convex CRV", symbol: "cvxCRV", address: "0x62B9c7356A2Dc64a1969e19C23e4f579F9810Aa7", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "convex", category: "contract", name: "Convex Booster", address: "0xF403C135812408BFbE8713b5A23a04b3D48AAE31", metadata: { role: "Booster" } },

  // ─── Yearn Finance ────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "yearn", category: "token", name: "yearn.finance", symbol: "YFI", address: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "yearn", category: "contract", name: "Yearn V3 Registry", address: "0xff31A1B020c868F6eA3f3cD2bB0a1a7f94Ffe0cf", metadata: { version: "v3", role: "Registry" } },
  { chain: "ethereum", protocol: "yearn", category: "contract", name: "Yearn DAI Vault", address: "0xdA816459F1AB5631232FE5e97a05BBBb94970c95", metadata: { version: "v2", baseToken: "DAI", role: "ERC4626Vault" } },
  { chain: "ethereum", protocol: "yearn", category: "contract", name: "Yearn USDC Vault", address: "0xa354F35829Ae975e850e23e9615b11Da1B3dC4DE", metadata: { version: "v2", baseToken: "USDC", role: "ERC4626Vault" } },
  { chain: "ethereum", protocol: "yearn", category: "contract", name: "Yearn WETH Vault", address: "0xa258C4606Ca8206D8aA700cE2143D7db854D168c", metadata: { version: "v2", baseToken: "WETH", role: "ERC4626Vault" } },

  // ─── Pendle ───────────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "pendle", category: "protocol", name: "Pendle Router V4", address: "0x888888888889758F76e7103c6CbF23ABbF58F946", metadata: { version: "v4", role: "Router" } },
  { chain: "ethereum", protocol: "pendle", category: "token", name: "Pendle", symbol: "PENDLE", address: "0x808507121B80c02388fAd14726482e061B8da827", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "pendle", category: "protocol", name: "Pendle Router V4", address: "0x888888888889758F76e7103c6CbF23ABbF58F946", metadata: { version: "v4", role: "Router" } },
  { chain: "arbitrum", protocol: "pendle", category: "token", name: "Pendle", symbol: "PENDLE", address: "0x0c880f6761F1af8d9Aa9C466984b80DAb9a8c9e8", metadata: { decimals: 18 } },

  // ─── EigenLayer ───────────────────────────────────────────────────────────────
  { chain: "ethereum", protocol: "eigenlayer", category: "contract", name: "EigenLayer Strategy Manager", address: "0x858646372CC42E1A627fcE94aa7A7033e7CF075A", metadata: { role: "StrategyManager" } },
  { chain: "ethereum", protocol: "eigenlayer", category: "contract", name: "EigenLayer Delegation Manager", address: "0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37b", metadata: { role: "DelegationManager" } },
  { chain: "ethereum", protocol: "eigenlayer", category: "contract", name: "EigenLayer stETH Strategy", address: "0x93c4b944D05dfe6df7645A86cd2206016c51564D", metadata: { role: "StrategyStETH" } },

  // ─── Additional stablecoins / tokens ─────────────────────────────────────────
  { chain: "ethereum", protocol: "token", category: "token", name: "USD0", symbol: "USD0", address: "0x73A15FeD60Bf67631dC6cd7Bc5B6e8da8190aCF5", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Chainlink", symbol: "LINK", address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Aave Token", symbol: "AAVE", address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Uniswap", symbol: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Curve DAO Token", symbol: "CRV", address: "0xD533a949740bb3306d119CC777fa900bA034cd52", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Compound", symbol: "COMP", address: "0xc00e94Cb662C3520282E6f5717214004A7f26888", metadata: { decimals: 18 } },
  { chain: "ethereum", protocol: "token", category: "token", name: "Synthetix", symbol: "SNX", address: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", metadata: { decimals: 18 } },
  { chain: "arbitrum", protocol: "token", category: "token", name: "Chainlink", symbol: "LINK", address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", metadata: { decimals: 18 } },
  { chain: "bnb", protocol: "token", category: "token", name: "Chainlink", symbol: "LINK", address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", metadata: { decimals: 18 } },
];

// ─── External Registry File Support ──────────────────────────────────────────
// Set AGENTRAIL_REGISTRY_FILE to a path of a JSON file containing
// an array of RegistryEntry objects to extend the registry at startup.
//
// Example file:
// [
//   { "chain": "ethereum", "protocol": "myprotocol", "category": "contract",
//     "name": "My Vault", "address": "0x..." }
// ]

function _loadExternalFile(): void {
  const filePath = process.env["AGENTRAIL_REGISTRY_FILE"];
  if (!filePath) return;
  try {
    if (!existsSync(filePath)) {
      process.stderr.write(`[agentrail] WARN: AGENTRAIL_REGISTRY_FILE not found: ${filePath}\n`);
      return;
    }
    const raw = readFileSync(filePath, "utf8");
    const entries = JSON.parse(raw) as RegistryEntry[];
    if (!Array.isArray(entries)) {
      process.stderr.write(`[agentrail] WARN: AGENTRAIL_REGISTRY_FILE must be a JSON array\n`);
      return;
    }
    _registryEntries.push(...entries);
    process.stderr.write(`[agentrail] INFO: Loaded ${entries.length} entries from ${filePath}\n`);
  } catch (err) {
    process.stderr.write(`[agentrail] WARN: Failed to load AGENTRAIL_REGISTRY_FILE: ${String(err)}\n`);
  }
}

// Initialize: populate with built-in entries then external file entries
_registryEntries.push(...BUILTIN_REGISTRY);
_loadExternalFile();

export function lookupRegistry(params: {
  chain?: SupportedChain;
  protocol?: string;
  category?: "token" | "protocol" | "market" | "contract";
  symbol?: string;
  name?: string;
  query?: string;
  /** Exact address match (case-insensitive) */
  address?: string;
}) {
  const query = params.query?.toLowerCase();
  const symbol = params.symbol?.toLowerCase();
  const name = params.name?.toLowerCase();
  const protocol = params.protocol?.toLowerCase();
  const address = params.address?.toLowerCase();

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
    // Address: exact match (case-insensitive). If only address is provided,
    // this becomes the sole filter — do NOT fall through to return true below.
    if (address) {
      return entry.address?.toLowerCase() === address;
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

export function getCompoundMarkets(chain: SupportedChain) {
  return REGISTRY.filter(
    (entry) => entry.chain === chain && entry.protocol === "compound" && entry.category === "protocol"
  );
}
