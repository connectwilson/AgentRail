import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  fallback,
  http,
  publicActions,
  type Abi,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arbitrum,
  base,
  bsc,
  mainnet,
  optimism,
  polygon
} from "viem/chains";
import type { SupportedChain } from "./types";
import { getRpcTransportConfig, getRpcUrls } from "./config";
import { AcpError } from "./errors";
import { getEnv } from "./env";

const chainMap = {
  local: defineChain({
    id: 31337,
    name: "Local",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: ["http://127.0.0.1:8545"]
      }
    }
  }),
  bnb: bsc,
  ethereum: mainnet,
  base,
  arbitrum,
  optimism,
  polygon
} as const satisfies Record<
  SupportedChain,
  typeof mainnet | typeof base | typeof bsc | typeof arbitrum | typeof optimism | typeof polygon | ReturnType<typeof defineChain>
>;

export function getPublicClient(chain: SupportedChain) {
  const rpcUrls = getRpcUrls(chain);
  const transportConfig = getRpcTransportConfig();
  return createPublicClient({
    chain: chainMap[chain],
    transport:
      rpcUrls.length === 1
        ? http(rpcUrls[0], transportConfig)
        : fallback(
            rpcUrls.map((url) => http(url, transportConfig)),
            {
              retryCount: 0,
              rank: false
            }
          )
  }).extend(publicActions);
}

export function getWalletClient(chain: SupportedChain, privateKey?: `0x${string}`) {
  const key =
    privateKey ??
    (getEnv("ACP_PRIVATE_KEY") as `0x${string}` | undefined) ??
    (getEnv("PRIVATE_KEY") as `0x${string}` | undefined);
  if (!key) {
    throw new AcpError(
      "SIGNER_MISSING",
      "Missing signer private key. Set ACP_PRIVATE_KEY or PRIVATE_KEY in the environment."
    );
  }

  const rpcUrls = getRpcUrls(chain);
  const transportConfig = getRpcTransportConfig();
  return createWalletClient({
    account: privateKeyToAccount(key),
    chain: chainMap[chain],
    transport:
      rpcUrls.length === 1
        ? http(rpcUrls[0], transportConfig)
        : fallback(
            rpcUrls.map((url) => http(url, transportConfig)),
            {
              retryCount: 0,
              rank: false
            }
          )
  });
}

export function buildCalldata(params: {
  abi: Abi;
  functionName: string;
  args?: unknown[];
}) {
  return encodeFunctionData({
    abi: params.abi,
    functionName: params.functionName,
    args: (params.args ?? []) as never
  });
}

export async function getBytecode(chain: SupportedChain, address: Address) {
  return getPublicClient(chain).getBytecode({ address });
}
