import { parseAbi, type Abi } from "viem";
import { getChainConfig } from "./config";
import { getEnv } from "./env";
import { AcpError } from "./errors";
import { STANDARD_ABIS } from "./standards";
import type { FunctionStateMutability, SupportedChain } from "./types";

type AbiResolution =
  | {
      abi: Abi;
      source:
        | "user-supplied"
        | "abi-path"
        | "sourcify"
        | "explorer"
        | "built-in-standards"
        | "function-signature";
    }
  | {
      abi: null;
      source: "none";
    };

type ExplorerAbiResult = {
  status?: string;
  message?: string;
  result?: string;
};

const EXPLORER_CONFIG: Partial<
  Record<SupportedChain, { apiUrl: string; apiKeyEnvVar?: string }>
> = {
  bnb: {
    apiUrl: "https://api.bscscan.com/api",
    apiKeyEnvVar: "BSCSCAN_API_KEY"
  },
  ethereum: {
    apiUrl: "https://api.etherscan.io/api",
    apiKeyEnvVar: "ETHERSCAN_API_KEY"
  },
  base: {
    apiUrl: "https://api.basescan.org/api",
    apiKeyEnvVar: "BASESCAN_API_KEY"
  },
  arbitrum: {
    apiUrl: "https://api.arbiscan.io/api",
    apiKeyEnvVar: "ARBISCAN_API_KEY"
  },
  optimism: {
    apiUrl: "https://api-optimistic.etherscan.io/api",
    apiKeyEnvVar: "OPTIMISTIC_ETHERSCAN_API_KEY"
  },
  polygon: {
    apiUrl: "https://api.polygonscan.com/api",
    apiKeyEnvVar: "POLYGONSCAN_API_KEY"
  }
};

export async function resolveAbi(params: {
  chain: SupportedChain;
  address: string;
  abi?: Abi;
  abiPath?: string;
  fallbackStandards?: string[];
  functionSignature?: string;
  returns?: string[];
  stateMutability?: FunctionStateMutability;
  loadLocalAbi: (abiPath: string) => Promise<Abi>;
}): Promise<AbiResolution> {
  if (params.abi) {
    return { abi: params.abi, source: "user-supplied" };
  }

  if (params.abiPath) {
    return { abi: await params.loadLocalAbi(params.abiPath), source: "abi-path" };
  }

  const sourcifyAbi = await fetchSourcifyAbi(params.chain, params.address);
  if (sourcifyAbi) {
    return { abi: sourcifyAbi, source: "sourcify" };
  }

  const explorerAbi = await fetchExplorerAbi(params.chain, params.address);
  if (explorerAbi) {
    return { abi: explorerAbi, source: "explorer" };
  }

  if ((params.fallbackStandards ?? []).length > 0) {
    const merged = params.fallbackStandards!.flatMap(
      (standard) => STANDARD_ABIS[standard] ?? []
    );
    if (merged.length > 0) {
      return { abi: merged as Abi, source: "built-in-standards" };
    }
  }

  if (params.functionSignature) {
    return {
      abi: buildMinimalAbiFromSignature({
        functionSignature: params.functionSignature,
        returns: params.returns,
        stateMutability: params.stateMutability
      }),
      source: "function-signature"
    };
  }

  return { abi: null, source: "none" };
}

async function fetchSourcifyAbi(chain: SupportedChain, address: string): Promise<Abi | null> {
  const chainId = getChainConfig(chain).chainId;
  const normalizedAddress = address.toLowerCase();
  const urls = [
    `https://repo.sourcify.dev/contracts/full_match/${chainId}/${normalizedAddress}/metadata.json`,
    `https://repo.sourcify.dev/contracts/partial_match/${chainId}/${normalizedAddress}/metadata.json`
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as { output?: { abi?: Abi } };
      if (payload.output?.abi && payload.output.abi.length > 0) {
        return payload.output.abi;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchExplorerAbi(chain: SupportedChain, address: string): Promise<Abi | null> {
  const config = EXPLORER_CONFIG[chain];
  if (!config) {
    return null;
  }

  const url = new URL(config.apiUrl);
  url.searchParams.set("module", "contract");
  url.searchParams.set("action", "getabi");
  url.searchParams.set("address", address);
  const apiKey = config.apiKeyEnvVar ? getEnv(config.apiKeyEnvVar) : undefined;
  if (apiKey) {
    url.searchParams.set("apikey", apiKey);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as ExplorerAbiResult;
    if (payload.status !== "1" || !payload.result) {
      return null;
    }
    return normalizeAbiJson(payload.result);
  } catch {
    return null;
  }
}

export function normalizeAbiJson(raw: string): Abi {
  const parsed = JSON.parse(raw) as Abi | string[];
  return Array.isArray(parsed) && typeof parsed[0] === "string"
    ? parseAbi(parsed)
    : (parsed as Abi);
}

export function requireAbi(result: AbiResolution): Abi {
  if (!result.abi) {
    throw new AcpError(
      "ABI_REQUIRED",
      "No ABI available. Pass abi/abiPath, use a verified contract, or target a supported built-in standard."
    );
  }
  return result.abi;
}

export function buildMinimalAbiFromSignature(params: {
  functionSignature: string;
  returns?: string[];
  stateMutability?: FunctionStateMutability;
}): Abi {
  const stateMutability = params.stateMutability ?? "view";
  const returnsClause =
    params.returns && params.returns.length > 0
      ? ` returns (${params.returns.join(",")})`
      : "";

  try {
    return parseAbi([
      `function ${params.functionSignature} ${stateMutability}${returnsClause}`.trim()
    ]);
  } catch (error) {
    throw new AcpError(
      "INVALID_FUNCTION_SIGNATURE",
      "Unable to build ABI from function signature. Pass a full ABI or provide a valid signature like balanceOf(address).",
      { functionSignature: params.functionSignature, reason: error instanceof Error ? error.message : String(error) }
    );
  }
}
