import {
  type Hex,
  type Abi,
  type Address
} from "viem";
import type {
  BatchReadParams,
  ActionPlanParams,
  AavePositionsParams,
  CompoundPositionsParams,
  UniswapQuoteParams,
  RegistryAddParams,
  ContractFunctionParams,
  ContractParams,
  FunctionStateMutability,
  RegistryLookupParams,
  ReadParams,
  ReceiptDecodeParams,
  ResponseEnvelope,
  TokenBalanceParams,
  TxBuildParams,
  TxSendParams,
  WriteLikeParams
} from "./types";
import { requireAbi, resolveAbi } from "./abi";
import { AcpError, getErrorAdvice } from "./errors";
import { getChainConfig } from "./config";
import { assertWriteAllowed, mergePolicy } from "./policy";
import { addRegistryEntries, getAaveMarketEntries, getCompoundMarkets, lookupRegistry } from "./registry";
import { ERC165_IDS, STANDARD_ABIS } from "./standards";
import {
  bigintReplacer,
  decodeLogWithAbi,
  formatDisplayValue,
  formatTokenValue,
  formatFunctionSignature,
  listAbiEvents,
  listAbiFunctions,
  loadAbiFromPath,
  normalizeAddress,
  resolveFunction,
  semanticTypeFromInput,
  summarizeFunctionRisk
} from "./utils";
import { buildCalldata, getBytecode, getPublicClient, getWalletClient } from "./rpc";
import { nonceManager } from "./nonce";
import { logger } from "./logger";
import { findTokensBySymbol, findTokensByName, tokenListEntryToHint } from "./token-list";
import { findProtocols, llamaProtocolToHint } from "./defi-llama";

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

async function detectStandards(params: ContractParams): Promise<string[]> {
  const client = getPublicClient(params.chain);
  const address = normalizeAddress(params.address);
  const standards = new Set<string>();

  const hasBytecode = await getBytecode(params.chain, address);
  if (!hasBytecode) {
    return [];
  }

  const supportsInterfaceAbi = [
    {
      type: "function",
      stateMutability: "view",
      name: "supportsInterface",
      inputs: [{ name: "interfaceId", type: "bytes4" }],
      outputs: [{ name: "", type: "bool" }]
    }
  ] as const satisfies Abi;

  const tryInterface = async (name: keyof typeof ERC165_IDS) => {
    try {
      const supported = await client.readContract({
        address,
        abi: supportsInterfaceAbi,
        functionName: "supportsInterface",
        args: [ERC165_IDS[name]]
      });
      if (supported) {
        standards.add(name);
      }
    } catch {
      return;
    }
  };

  await Promise.all([tryInterface("ERC165"), tryInterface("ERC721"), tryInterface("ERC1155")]);

  const functionSurface = async (abi: Abi, functions: string[]) => {
    const available = await Promise.all(
      functions.map(async (fnName) => {
        try {
          const fn = resolveFunction(abi, fnName);
          await client.readContract({
            address,
            abi,
            functionName: fn.name,
            args: []
          });
          return true;
        } catch {
          return false;
        }
      })
    );
    return available.every(Boolean);
  };

  if (await functionSurface(STANDARD_ABIS.ERC20, ["decimals", "symbol", "totalSupply"])) {
    standards.add("ERC20");
  }
  if (await functionSurface(STANDARD_ABIS.ERC4626, ["asset"])) {
    standards.add("ERC4626");
  }

  return Array.from(standards);
}

async function getStandardsIfNeeded(params: ContractParams) {
  if (
    params.abi ||
    params.abiPath ||
    ("returns" in params && Array.isArray(params.returns)) ||
    ("stateMutability" in params && typeof params.stateMutability === "string")
  ) {
    return [];
  }
  return detectStandards(params);
}

async function getImplementationAddress(chain: ContractParams["chain"], address: Address) {
  const client = getPublicClient(chain);
  try {
    const slot = await client.getStorageAt({
      address,
      slot: EIP1967_IMPLEMENTATION_SLOT
    });
    if (!slot || /^0x0+$/.test(slot)) {
      return null;
    }
    return normalizeAddress(`0x${slot.slice(-40)}`);
  } catch {
    return null;
  }
}

async function getPreferredAbi(
  params: ContractParams,
  standards: string[],
  defaultStateMutability: "view" | "nonpayable" = "view"
) {
  return resolveAbi({
    chain: params.chain,
    address: params.address,
    abi: params.abi,
    abiPath: params.abiPath,
    fallbackStandards: standards,
    functionSignature:
      "function" in params && typeof params.function === "string" ? params.function : undefined,
    returns:
      "returns" in params && Array.isArray(params.returns) ? params.returns : undefined,
    stateMutability:
      "stateMutability" in params && typeof params.stateMutability === "string"
        ? (params.stateMutability as FunctionStateMutability)
        : defaultStateMutability,
    loadLocalAbi: loadAbiFromPath
  });
}

function buildEventOnlyAbi(abis: Abi[]): Abi {
  return abis.flatMap((abi) => listAbiEvents(abi));
}

function summarizeDecodedEvent(eventName: string, args: Record<string, unknown>) {
  if (eventName === "Transfer") {
    return {
      kind: "transfer",
      from: args.from,
      to: args.to,
      value: formatDisplayValue(args.value ?? args.tokenId)
    };
  }
  if (eventName === "Approval") {
    return {
      kind: "approval",
      owner: args.owner,
      spender: args.spender ?? args.approved,
      value: formatDisplayValue(args.value ?? args.tokenId)
    };
  }
  if (eventName === "ApprovalForAll") {
    return {
      kind: "approval_for_all",
      owner: args.owner ?? args.account,
      operator: args.operator,
      approved: args.approved
    };
  }
  return {
    kind: eventName.toLowerCase(),
    args: JSON.parse(JSON.stringify(args, bigintReplacer))
  };
}

function normalizeDecodedArgs(args: unknown): Record<string, unknown> {
  if (!args || Array.isArray(args) || typeof args !== "object") {
    return {};
  }
  return args as Record<string, unknown>;
}

function hasBalanceFields(
  position: Record<string, unknown>
): position is Record<string, unknown> & { formatted?: string; decoded?: string } {
  return "formatted" in position || "decoded" in position;
}

export async function contractInspect(
  params: ContractParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const address = normalizeAddress(params.address);
  const bytecode = await getBytecode(params.chain, address);
  const standards = bytecode ? await getStandardsIfNeeded(params) : [];
  const abiResult = bytecode ? await getPreferredAbi(params, standards) : { abi: null, source: "none" as const };
  const implementation = bytecode ? await getImplementationAddress(params.chain, address) : null;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      address,
      chainId: getChainConfig(params.chain).chainId,
      isContract: Boolean(bytecode),
      bytecodeSize: bytecode ? (bytecode.length - 2) / 2 : 0,
      proxyInfo: {
        standard: implementation ? "EIP-1967" : null,
        implementation
      },
      standardsDetected: standards,
      abiSource: abiResult.source,
      functionCount: abiResult.abi ? listAbiFunctions(abiResult.abi).length : 0,
      riskHints: implementation
        ? ["Upgradeable proxy detected; behavior may change if implementation is upgraded."]
        : []
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function contractFunctions(
  params: ContractParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "view");
  const abi = requireAbi(abiResult);
  const functions = listAbiFunctions(abi).map((item) => ({
    name: item.name,
    signature: formatFunctionSignature(item),
    stateMutability: item.stateMutability,
    inputs: item.inputs,
    outputs: item.outputs,
    riskLevel: summarizeFunctionRisk(item.name)
  }));

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: { functions, standardsDetected: standards, abiSource: abiResult.source },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function contractDescribe(
  params: ContractFunctionParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "view");
  const abi = requireAbi(abiResult);
  const fn = resolveFunction(abi, params.function);
  const signature = formatFunctionSignature(fn);
  const lowered = fn.name.toLowerCase();
  const preconditions: string[] = [];
  const riskHints: string[] = [];

  if (["deposit", "mint", "stake"].some((verb) => lowered.includes(verb))) {
    preconditions.push("Caller may need token approval before this call succeeds.");
    riskHints.push("Result may differ between simulation and final execution if pool state changes.");
  }
  if (lowered.includes("approve") || lowered.includes("setapprovalforall")) {
    riskHints.push("This function changes spending permissions and can create broad asset access.");
  }
  if (lowered.includes("transfer")) {
    preconditions.push("Caller must own or control the asset being transferred.");
  }

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      name: fn.name,
      signature,
      stateMutability: fn.stateMutability,
      summary: summarizeFunction(fn.name),
      inputs: fn.inputs.map((input) => ({
        ...input,
        semanticType: semanticTypeFromInput(input.name, input.type)
      })),
      outputs: fn.outputs,
      preconditions,
      riskHints,
      abiSource: abiResult.source
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

function summarizeFunction(name: string) {
  const lowered = name.toLowerCase();
  if (lowered === "balanceof") {
    return "Read the asset balance for an address.";
  }
  if (lowered === "allowance") {
    return "Read the remaining approved spend for a spender.";
  }
  if (lowered.includes("approve")) {
    return "Grant spending or operator permission to another address.";
  }
  if (lowered.includes("transfer")) {
    return "Move tokens or NFTs between addresses.";
  }
  if (lowered.includes("deposit")) {
    return "Deposit assets into the protocol in exchange for a position or shares.";
  }
  return "Invoke the target contract function using the provided ABI schema.";
}

async function readContractValue(params: ReadParams) {
  const address = normalizeAddress(params.address);
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "view");
  const abi = requireAbi(abiResult);
  const fn = resolveFunction(abi, params.function);
  const client = getPublicClient(params.chain);
  const raw = await client.readContract({
    address,
    abi,
    functionName: fn.name,
    args: (params.args ?? []) as never,
    blockTag:
      typeof params.blockTag === "bigint" ? undefined : (params.blockTag as "latest" | undefined),
    blockNumber: typeof params.blockTag === "bigint" ? params.blockTag : undefined
  });

  return {
    raw,
    abiSource: abiResult.source
  };
}

async function getTokenMetadata(params: {
  chain: ContractParams["chain"];
  token: string;
  symbol?: string;
  decimals?: number;
  abi?: Abi;
  abiPath?: string;
}) {
  let symbol = params.symbol ?? null;
  let decimals = params.decimals ?? null;

  if (symbol !== null && decimals !== null) {
    return { symbol, decimals, source: "request" as const };
  }

  try {
    if (symbol === null) {
      const symbolRead = await readContractValue({
        chain: params.chain,
        address: params.token,
        abi: params.abi,
        abiPath: params.abiPath,
        function: "symbol()",
        returns: ["string"]
      });
      symbol = typeof symbolRead.raw === "string" ? symbolRead.raw : formatDisplayValue(symbolRead.raw);
    }
  } catch {
    symbol = symbol ?? null;
  }

  try {
    if (decimals === null) {
      const decimalsRead = await readContractValue({
        chain: params.chain,
        address: params.token,
        abi: params.abi,
        abiPath: params.abiPath,
        function: "decimals()",
        returns: ["uint8"]
      });
      decimals =
        typeof decimalsRead.raw === "bigint"
          ? Number(decimalsRead.raw)
          : Number(formatDisplayValue(decimalsRead.raw));
      if (!Number.isFinite(decimals)) {
        decimals = null;
      }
    }
  } catch {
    decimals = decimals ?? null;
  }

  return {
    symbol,
    decimals,
    source: "auto" as const
  };
}

export async function contractRead(
  params: ReadParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const { raw, abiSource } = await readContractValue(params);

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      raw: JSON.parse(JSON.stringify(raw, bigintReplacer)),
      decoded: formatDisplayValue(raw),
      formatted: formatTokenValue(raw, params.decimals),
      abiSource
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function registryLookup(
  params: RegistryLookupParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const entries = lookupRegistry(params);
  const bestMatch = entries[0] ?? null;

  // ── On-chain fallback (address probe) ────────────────────────────────────────
  // Triggered when:
  //   a) an explicit address was provided but not found in the registry, OR
  //   b) a free-text query looks like an address and returned no hits
  let onChainHint: Record<string, unknown> | null = null;
  const addressLike = (params.address ?? params.query)?.match(/^0x[0-9a-fA-F]{40}$/i);
  const addressNotInRegistry = !!addressLike && (
    entries.length === 0 ||
    !entries.some((e) => e.address?.toLowerCase() === addressLike[0].toLowerCase())
  );
  if (addressNotInRegistry && params.chain) {
    const candidate = addressLike[0];
    try {
      const client = getPublicClient(params.chain);
      const probeAbi = STANDARD_ABIS.ERC20;
      const [symbol, name, decimals] = await Promise.all([
        client.readContract({ address: candidate as Address, abi: probeAbi, functionName: "symbol", args: [] }).catch(() => null) as Promise<string | null>,
        client.readContract({ address: candidate as Address, abi: probeAbi, functionName: "name", args: [] }).catch(() => null) as Promise<string | null>,
        client.readContract({ address: candidate as Address, abi: probeAbi, functionName: "decimals", args: [] }).catch(() => null) as Promise<number | null>
      ]);
      if (symbol || name) {
        onChainHint = {
          address: candidate,
          symbol: symbol ?? null,
          name: name ?? null,
          decimals: decimals ?? null,
          source: "onchain-probe",
          note: "Not in registry but responded to ERC20 probes. Call registry.add to register permanently."
        };
      }
    } catch { /* chain unavailable */ }
  }

  // ── Token list fallback (symbol / name queries) ───────────────────────────────
  let tokenListHints: Record<string, unknown>[] = [];
  if (entries.length === 0 && !onChainHint) {
    const sym = params.symbol;
    const qry = params.query;
    if (sym) {
      const found = await findTokensBySymbol(sym, params.chain).catch(() => []);
      tokenListHints = found.slice(0, 5).map(tokenListEntryToHint);
    } else if (qry && !/^0x/.test(qry)) {
      // Free-text: try as symbol first, then name
      const bySymbol = await findTokensBySymbol(qry, params.chain).catch(() => []);
      const byName = bySymbol.length === 0
        ? await findTokensByName(qry, params.chain).catch(() => [])
        : [];
      tokenListHints = [...bySymbol, ...byName].slice(0, 5).map(tokenListEntryToHint);
    }
  }

  // ── DeFiLlama fallback (protocol queries) ────────────────────────────────────
  let llamaHints: Record<string, unknown>[] = [];
  if (entries.length === 0 && !onChainHint && tokenListHints.length === 0) {
    const protocolQuery = params.protocol ?? params.query;
    if (protocolQuery && !/^0x/.test(protocolQuery)) {
      const found = await findProtocols(protocolQuery, params.chain).catch(() => []);
      llamaHints = found.slice(0, 3).map((p) => llamaProtocolToHint(p, params.chain));
    }
  }

  // ── Actionable suggestions ───────────────────────────────────────────────────
  const suggestions: string[] = [];
  if (entries.length === 0) {
    if (onChainHint) {
      suggestions.push(`Call registry.add with chain="${params.chain}", address="${addressLike?.[0]}" to register this contract.`);
    } else if (tokenListHints.length > 0) {
      suggestions.push(`Found ${tokenListHints.length} match(es) in Uniswap token list — see tokenListHints.`);
      suggestions.push("Call registry.add with the address from tokenListHints to register permanently.");
    } else if (llamaHints.length > 0) {
      suggestions.push(`Found ${llamaHints.length} protocol(s) on DeFiLlama — see llamaHints for contract URLs.`);
      suggestions.push("Find the specific contract address on DeFiLlama, then call registry.add to register it.");
    } else {
      suggestions.push("Try a free-text query param for broader matching.");
      suggestions.push("If you have the contract address, call contract.inspect to identify it automatically.");
      suggestions.push("Use registry.add to register any contract address manually.");
      if (params.symbol) {
        suggestions.push(`Set AGENTRAIL_REGISTRY_FILE to a JSON file containing the ${params.symbol} token entry.`);
      }
    }
  }

  // ── Build summary ─────────────────────────────────────────────────────────────
  const summary = bestMatch
    ? `Found ${entries.length} registry match${entries.length === 1 ? "" : "es"}; best match is ${bestMatch.name}${bestMatch.address ? ` at ${bestMatch.address}` : ""}.`
    : onChainHint
      ? `Not in registry, but on-chain ERC20 probe found: ${String(onChainHint.symbol ?? onChainHint.name)}. Call registry.add to register.`
      : tokenListHints.length > 0
        ? `Not in registry, but found ${tokenListHints.length} match(es) in the Uniswap token list. See tokenListHints.`
        : llamaHints.length > 0
          ? `Not in registry, but found ${llamaHints.length} match(es) on DeFiLlama. See llamaHints for details.`
          : "No registry matches found. See suggestions for next steps.";

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      entries,
      count: entries.length,
      bestMatch,
      onChainHint,
      tokenListHints: tokenListHints.length > 0 ? tokenListHints : undefined,
      llamaHints: llamaHints.length > 0 ? llamaHints : undefined,
      suggestions: suggestions.length > 0 ? suggestions : undefined,
      summary
    },
    meta: {
      chain: params.chain,
      chainId: params.chain ? getChainConfig(params.chain).chainId : undefined,
      timestamp: new Date().toISOString()
    }
  };
}

export async function tokenBalance(
  params: TokenBalanceParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const metadata = await getTokenMetadata(params);
  const decimals = metadata.decimals ?? undefined;
  const read = await contractRead({
    chain: params.chain,
    address: params.token,
    abi: params.abi,
    abiPath: params.abiPath,
    function: "balanceOf(address)",
    args: [params.owner],
    returns: ["uint256"],
    decimals
  });

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      token: params.token,
      owner: params.owner,
      symbol: metadata.symbol,
      decimals: metadata.decimals,
      raw: read.result?.raw,
      decoded: read.result?.decoded,
      formatted:
        read.result?.formatted ?? formatTokenValue(read.result?.decoded ?? null, metadata.decimals ?? undefined),
      metadataSource: metadata.source,
      abiSource: read.result?.abiSource
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function aavePositions(
  params: AavePositionsParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const assets =
    params.assets ??
    getAaveMarketEntries(params.chain).map((entry) => ({
      symbol: entry.symbol ?? entry.name,
      aTokenAddress: entry.address ?? "",
      decimals:
        typeof entry.metadata?.decimals === "number" ? (entry.metadata.decimals as number) : undefined
    }));

  const positions = await Promise.all(
    assets.map(async (asset) => {
      try {
        const balance = await tokenBalance({
          chain: params.chain,
          token: asset.aTokenAddress,
          owner: params.owner,
          symbol: asset.symbol,
          decimals: asset.decimals
        });
        const formatted = balance.result?.formatted;
        const isSupplied =
          typeof formatted === "string"
            ? Number(formatted) > 0
            : typeof balance.result?.decoded === "string"
              ? BigInt(balance.result.decoded) > 0n
              : false;
        return {
          symbol: asset.symbol,
          aTokenAddress: asset.aTokenAddress,
          supplied: isSupplied,
          ...balance.result
        };
      } catch (error) {
        const normalized =
          error instanceof AcpError
            ? error
            : new AcpError("AAVE_POSITION_READ_FAILED", error instanceof Error ? error.message : String(error));
        return {
          symbol: asset.symbol,
          aTokenAddress: asset.aTokenAddress,
          supplied: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            advice: getErrorAdvice(normalized)
          }
        };
      }
    })
  );

  const nonZeroPositions = positions.filter((position) => position.supplied);
  const highlights = nonZeroPositions.map((position) => {
    const value = hasBalanceFields(position as Record<string, unknown>)
      ? typeof (position as Record<string, unknown>).formatted === "string"
        ? ((position as Record<string, unknown>).formatted as string)
        : typeof (position as Record<string, unknown>).decoded === "string"
          ? ((position as Record<string, unknown>).decoded as string)
          : null
      : null;
    return {
      symbol: position.symbol,
      aTokenAddress: position.aTokenAddress,
      value,
      supplied: position.supplied
    };
  });
  const summary =
    nonZeroPositions.length === 0
      ? `No supplied Aave positions were found across ${positions.length} tracked assets on ${params.chain}.`
      : `Found ${nonZeroPositions.length} non-zero Aave supplied position${nonZeroPositions.length === 1 ? "" : "s"} across ${positions.length} tracked assets on ${params.chain}: ${nonZeroPositions
          .map((position) => {
            const value = hasBalanceFields(position as Record<string, unknown>)
              ? typeof (position as Record<string, unknown>).formatted === "string"
                ? ((position as Record<string, unknown>).formatted as string)
                : typeof (position as Record<string, unknown>).decoded === "string"
                  ? ((position as Record<string, unknown>).decoded as string)
                  : null
              : null;
            return `${position.symbol}=${value ?? "unknown"}`;
          })
          .join(", ")}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      owner: params.owner,
      protocol: "aave",
      trackedAssetsCount: positions.length,
      nonZeroPositionsCount: nonZeroPositions.length,
      summary,
      highlights,
      positions,
      nonZeroPositions
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function batchRead(
  params: BatchReadParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const items = await Promise.all(
    params.items.map(async (item, index) => {
      try {
        const response = await contractRead(item);
        return {
          index,
          ok: true,
          result: response.result
        };
      } catch (error) {
        const normalized = error instanceof AcpError
          ? error
          : new AcpError("READ_FAILED", error instanceof Error ? error.message : String(error));
        return {
          index,
          ok: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            data: normalized.data,
            advice: getErrorAdvice(normalized)
          }
        };
      }
    })
  );

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      items
    },
    meta: {
      timestamp: new Date().toISOString()
    }
  };
}

export async function contractSimulate(
  params: WriteLikeParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const address = normalizeAddress(params.address);
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "nonpayable");
  const abi = requireAbi(abiResult);
  assertWriteAllowed({
    abi,
    functionId: params.function,
    contractAddress: address,
    value: params.value,
    policy: params.policy
  });
  const fn = resolveFunction(abi, params.function);
  const caller = params.caller ? normalizeAddress(params.caller) : undefined;
  if (!caller) {
    throw new AcpError("CALLER_REQUIRED", "caller is required for simulation of write functions.");
  }
  const client = getPublicClient(params.chain);
  const policy = mergePolicy(params.policy);

  try {
    const simulation = await client.simulateContract({
      account: caller,
      address,
      abi,
      functionName: fn.name,
      args: (params.args ?? []) as never,
      value: params.value ? BigInt(params.value) : undefined
    });

    const gasEstimate = await client.estimateContractGas({
      account: caller,
      address,
      abi,
      functionName: fn.name,
      args: (params.args ?? []) as never,
      value: params.value ? BigInt(params.value) : undefined
    });

    return {
      id: crypto.randomUUID(),
      ok: true,
      result: {
        simulation: {
          success: true,
          request: {
            to: simulation.request.address,
            data: buildCalldata({
              abi,
              functionName: fn.name,
              args: params.args
            }),
            account: simulation.request.account?.address ?? caller
          },
          gasEstimate: gasEstimate.toString(),
          result: JSON.parse(JSON.stringify(simulation.result, bigintReplacer)),
          humanSummary: buildHumanSummary(fn.name, params.args ?? [])
        },
        policy: {
          allowWrites: policy.allowWrites,
          simulationRequired: policy.simulationRequired
        },
        abiSource: abiResult.source
      },
      meta: {
        chain: params.chain,
        chainId: getChainConfig(params.chain).chainId,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    throw new AcpError("SIMULATION_FAILED", "Contract simulation failed.", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildHumanSummary(name: string, args: unknown[]) {
  if (name === "transfer" && args.length >= 2) {
    return `This call would transfer ${args[1]} units to ${args[0]}.`;
  }
  if (name === "approve" && args.length >= 2) {
    return `This call would approve ${args[0]} to spend up to ${args[1]} units.`;
  }
  if (name === "deposit" && args.length >= 2) {
    return `This call would deposit ${args[0]} units for receiver ${args[1]}.`;
  }
  return `This call would execute ${name}.`;
}

export async function txBuild(
  params: TxBuildParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const address = normalizeAddress(params.address);
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "nonpayable");
  const abi = requireAbi(abiResult);
  assertWriteAllowed({
    abi,
    functionId: params.function,
    contractAddress: address,
    value: params.value,
    policy: params.policy
  });
  const fn = resolveFunction(abi, params.function);
  const caller = params.caller ? normalizeAddress(params.caller) : undefined;
  if (!caller) {
    throw new AcpError("CALLER_REQUIRED", "caller is required to build a write transaction.");
  }
  const client = getPublicClient(params.chain);
  const data = buildCalldata({
    abi,
    functionName: fn.name,
    args: params.args
  });
  const gas = params.gas
    ? BigInt(params.gas)
    : await client.estimateContractGas({
        account: caller,
        address,
        abi,
        functionName: fn.name,
        args: (params.args ?? []) as never,
        value: params.value ? BigInt(params.value) : undefined
      });
  const fees = await client.estimateFeesPerGas();
  const nonce =
    params.nonce !== undefined
      ? params.nonce
      : await client.getTransactionCount({ address: caller });

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      to: address,
      from: caller,
      data,
      value: params.value ?? "0",
      gasLimit: gas.toString(),
      nonce,
      chainId: getChainConfig(params.chain).chainId,
      abiSource: abiResult.source,
      maxFeePerGas: params.maxFeePerGas ?? fees.maxFeePerGas?.toString() ?? null,
      maxPriorityFeePerGas:
        params.maxPriorityFeePerGas ?? fees.maxPriorityFeePerGas?.toString() ?? null,
      warnings: [
        "Transaction is not signed.",
        "Run contract.simulate first and persist the simulation result in your agent flow."
      ]
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function txSend(
  params: TxSendParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const address = normalizeAddress(params.address);
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "nonpayable");
  const abi = requireAbi(abiResult);
  assertWriteAllowed({
    abi,
    functionId: params.function,
    contractAddress: address,
    value: params.value,
    policy: params.policy
  });

  const fn = resolveFunction(abi, params.function);
  const policy = mergePolicy(params.policy);
  const walletClient = getWalletClient(params.chain);
  const signerAddress = walletClient.account.address;
  const caller = params.caller ? normalizeAddress(params.caller) : signerAddress;

  if (caller !== signerAddress) {
    throw new AcpError(
      "SIGNER_CALLER_MISMATCH",
      "caller must match the configured signer address for tx.send.",
      { caller, signerAddress }
    );
  }

  const publicClient = getPublicClient(params.chain);

  if (policy.simulationRequired) {
    await publicClient.simulateContract({
      account: signerAddress,
      address,
      abi,
      functionName: fn.name,
      args: (params.args ?? []) as never,
      value: params.value ? BigInt(params.value) : undefined
    });
  }

  const gas = params.gas
    ? BigInt(params.gas)
    : await publicClient.estimateContractGas({
        account: signerAddress,
        address,
        abi,
        functionName: fn.name,
        args: (params.args ?? []) as never,
        value: params.value ? BigInt(params.value) : undefined
      });
  const fees = await publicClient.estimateFeesPerGas();

  // Use nonce manager to prevent conflicts on concurrent sends
  const nonce =
    params.nonce !== undefined
      ? params.nonce
      : await nonceManager.acquire(params.chain, signerAddress, () =>
          publicClient.getTransactionCount({ address: signerAddress })
        );

  try {
    logger.info("tx.send.attempt", { chain: params.chain, function: formatFunctionSignature(fn), nonce });
    const hash = await walletClient.writeContract({
      account: signerAddress,
      address,
      abi,
      functionName: fn.name,
      args: (params.args ?? []) as never,
      value: params.value ? BigInt(params.value) : undefined,
      gas,
      nonce,
      maxFeePerGas: params.maxFeePerGas
        ? BigInt(params.maxFeePerGas)
        : fees.maxFeePerGas,
      maxPriorityFeePerGas: params.maxPriorityFeePerGas
        ? BigInt(params.maxPriorityFeePerGas)
        : fees.maxPriorityFeePerGas
    });

    logger.info("tx.send.broadcast", { chain: params.chain, hash, nonce });

    return {
      id: crypto.randomUUID(),
      ok: true,
      result: {
        hash,
        from: signerAddress,
        to: address,
        function: formatFunctionSignature(fn),
        chainId: getChainConfig(params.chain).chainId,
        abiSource: abiResult.source,
        simulated: policy.simulationRequired,
        nonce,
        gasLimit: gas.toString()
      },
      meta: {
        chain: params.chain,
        chainId: getChainConfig(params.chain).chainId,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    // Reset nonce so the next attempt re-fetches from chain
    nonceManager.reset(params.chain, signerAddress);
    logger.error("tx.send.failed", {
      chain: params.chain,
      nonce,
      error: error instanceof Error ? error.message : String(error)
    });
    throw new AcpError("TX_SEND_FAILED", "Failed to sign or broadcast transaction.", {
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function receiptDecode(
  params: ReceiptDecodeParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const client = getPublicClient(params.chain);
  const receipt = await client.getTransactionReceipt({
    hash: params.hash as Hex
  });
  const tx = await client.getTransaction({
    hash: params.hash as Hex
  });

  const standards = params.address ? await getStandardsIfNeeded(params) : [];
  const abiResult = await getPreferredAbi(params, standards);
  const decodeAbis: Abi[] = [];
  if (abiResult.abi) {
    decodeAbis.push(abiResult.abi);
  }
  if (standards.length > 0) {
    decodeAbis.push(...standards.map((standard) => STANDARD_ABIS[standard]).filter(Boolean));
  }
  decodeAbis.push(STANDARD_ABIS.ERC20, STANDARD_ABIS.ERC721, STANDARD_ABIS.ERC1155);
  const eventAbi = buildEventOnlyAbi(decodeAbis);

  const decodedLogs = receipt.logs.map((log) => {
    const decoded = decodeLogWithAbi({
      abi: eventAbi,
      data: log.data,
      topics: log.topics
    });

    if (!decoded) {
      return {
        address: log.address,
        eventName: null,
        decoded: false,
        topics: log.topics,
        data: log.data
      };
    }

    const eventName = decoded.eventName ?? "unknown";
    const args = normalizeDecodedArgs(decoded.args);
    return {
      address: log.address,
      eventName,
      decoded: true,
      args: JSON.parse(JSON.stringify(args, bigintReplacer)),
      summary: summarizeDecodedEvent(eventName, args)
    };
  });

  const effects = decodedLogs
    .filter((log) => log.decoded && "summary" in log)
    .map((log) => ({
      address: log.address,
      eventName: log.eventName,
      effect: log.summary
    }));

  const summary =
    effects.length === 0
      ? `Decoded receipt for ${params.hash} with no recognized token or approval events.`
      : `Decoded receipt for ${params.hash}; recognized ${effects.length} effect${effects.length === 1 ? "" : "s"}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      hash: params.hash,
      chainId: getChainConfig(params.chain).chainId,
      status: receipt.status,
      blockNumber: receipt.blockNumber.toString(),
      from: tx.from,
      to: tx.to,
      contractAddress: receipt.contractAddress,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice?.toString() ?? null,
      summary,
      effects,
      logs: decodedLogs,
      abiSource: abiResult.source
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

export async function actionPlan(
  params: ActionPlanParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const goal = params.goal.toLowerCase();
  const steps: Array<Record<string, unknown>> = [];

  if (goal.includes("aave") && (goal.includes("position") || goal.includes("supply"))) {
    steps.push({
      type: "lookup",
      method: "registry.lookup",
      purpose: "Find known Aave market contracts or aToken addresses for the target chain."
    });
    steps.push({
      type: "read",
      method: "aave.positions",
      purpose: "Read supplied balances across the configured Aave assets for the owner."
    });
  } else if (goal.includes("balance")) {
    steps.push({
      type: "read",
      method: "token.balance",
      purpose: "Read token balance with metadata and formatted output."
    });
  } else if (goal.includes("deposit") || goal.includes("supply") || goal.includes("stake")) {
    steps.push({
      type: "inspect",
      method: "contract.describe",
      purpose: "Confirm the target write function and parameter schema."
    });
    steps.push({
      type: "simulate",
      method: "contract.simulate",
      purpose: "Verify the call succeeds before building or sending a transaction."
    });
    steps.push({
      type: "build",
      method: "tx.build",
      purpose: "Build the unsigned transaction payload."
    });
    steps.push({
      type: "send",
      method: "tx.send",
      purpose: "Broadcast the transaction using the configured signer."
    });
    steps.push({
      type: "decode",
      method: "receipt.decode",
      purpose: "Decode logs and summarize what changed onchain."
    });
  } else {
    steps.push({
      type: "discover",
      method: "rpc.discover",
      purpose: "Inspect protocol capabilities and available method aliases."
    });
    steps.push({
      type: "inspect",
      method: "contract.inspect",
      purpose: "Inspect the target contract before selecting a read or write method."
    });
  }

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      goal: params.goal,
      chain: params.chain,
      protocol: params.protocol ?? null,
      owner: params.owner ?? null,
      target: params.target ?? null,
      asset: params.asset ?? null,
      amount: params.amount ?? null,
      steps
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

// ─── Compound V3 (Comet) Positions ───────────────────────────────────────────

const COMET_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "borrowBalanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "getAssetInfoByAddress",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "info",
        type: "tuple",
        components: [
          { name: "offset", type: "uint8" },
          { name: "asset", type: "address" },
          { name: "priceFeed", type: "address" },
          { name: "scale", type: "uint64" },
          { name: "borrowCollateralFactor", type: "uint64" },
          { name: "liquidateCollateralFactor", type: "uint64" },
          { name: "liquidationFactor", type: "uint64" },
          { name: "supplyCap", type: "uint128" }
        ]
      }
    ]
  }
] as const;

export async function compoundPositions(
  params: CompoundPositionsParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const registryMarkets = getCompoundMarkets(params.chain);
  const markets =
    params.markets ??
    registryMarkets.map((entry) => ({
      address: entry.address ?? "",
      baseToken: String(entry.metadata?.baseToken ?? "?"),
      baseTokenDecimals: Number(entry.metadata?.baseTokenDecimals ?? 6)
    }));

  const client = getPublicClient(params.chain);
  const owner = normalizeAddress(params.owner);

  const positions = await Promise.all(
    markets
      .filter((m) => Boolean(m.address))
      .map(async (market) => {
        try {
          const marketAddress = normalizeAddress(market.address);
          const [supplyRaw, borrowRaw] = await Promise.all([
            client.readContract({
              address: marketAddress,
              abi: COMET_ABI,
              functionName: "balanceOf",
              args: [owner]
            }),
            client.readContract({
              address: marketAddress,
              abi: COMET_ABI,
              functionName: "borrowBalanceOf",
              args: [owner]
            })
          ]);
          const supplyFormatted = formatTokenValue(supplyRaw, market.baseTokenDecimals);
          const borrowFormatted = formatTokenValue(borrowRaw, market.baseTokenDecimals);
          const hasSupply = supplyRaw > 0n;
          const hasBorrow = borrowRaw > 0n;
          return {
            market: market.address,
            baseToken: market.baseToken,
            supplyRaw: supplyRaw.toString(),
            supplyFormatted,
            borrowRaw: borrowRaw.toString(),
            borrowFormatted,
            hasSupply,
            hasBorrow
          };
        } catch (error) {
          return {
            market: market.address,
            baseToken: market.baseToken,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      })
  );

  const activePositions = positions.filter(
    (p) => !("error" in p) && (p.hasSupply || p.hasBorrow)
  );
  const summary =
    activePositions.length === 0
      ? `No active Compound V3 positions found for ${params.owner} across ${positions.length} markets on ${params.chain}.`
      : `Found ${activePositions.length} active Compound V3 position${activePositions.length === 1 ? "" : "s"} on ${params.chain}: ${activePositions.map((p) => `${p.baseToken}(supply=${p.supplyFormatted ?? p.supplyRaw},borrow=${p.borrowFormatted ?? p.borrowRaw})`).join(", ")}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      owner: params.owner,
      protocol: "compound",
      version: "v3",
      trackedMarketsCount: positions.length,
      activePositionsCount: activePositions.length,
      summary,
      positions,
      activePositions
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

// ─── Uniswap V3 Quote ─────────────────────────────────────────────────────────

const QUOTER_V2_ABI = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" }
        ]
      }
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" }
    ]
  }
] as const;

const DEFAULT_QUOTER_ADDRESSES: Partial<Record<string, string>> = {
  ethereum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  arbitrum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  optimism: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  polygon: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  base: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a"
};

export async function uniswapQuote(
  params: UniswapQuoteParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const quoterAddress =
    params.quoterAddress ?? DEFAULT_QUOTER_ADDRESSES[params.chain];
  if (!quoterAddress) {
    throw new AcpError(
      "QUOTER_NOT_FOUND",
      `No Uniswap V3 QuoterV2 address known for chain '${params.chain}'. Provide quoterAddress explicitly.`
    );
  }

  const tokenIn = normalizeAddress(params.tokenIn);
  const tokenOut = normalizeAddress(params.tokenOut);
  const fee = params.feeTier ?? 3000;
  const amountIn = BigInt(params.amountIn);
  const client = getPublicClient(params.chain);

  // Fetch decimals for tokenIn and tokenOut to format the result
  const [tokenInDecimals, tokenOutDecimals, tokenInSymbol, tokenOutSymbol] = await Promise.all([
    client.readContract({ address: tokenIn, abi: STANDARD_ABIS.ERC20, functionName: "decimals", args: [] }).catch(() => undefined) as Promise<number | undefined>,
    client.readContract({ address: tokenOut, abi: STANDARD_ABIS.ERC20, functionName: "decimals", args: [] }).catch(() => undefined) as Promise<number | undefined>,
    client.readContract({ address: tokenIn, abi: STANDARD_ABIS.ERC20, functionName: "symbol", args: [] }).catch(() => undefined) as Promise<string | undefined>,
    client.readContract({ address: tokenOut, abi: STANDARD_ABIS.ERC20, functionName: "symbol", args: [] }).catch(() => undefined) as Promise<string | undefined>
  ]);

  try {
    const result = await client.simulateContract({
      address: normalizeAddress(quoterAddress),
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }]
    });

    const amountOut: bigint = result.result[0];
    const gasEstimate: bigint = result.result[3];

    const amountInFormatted = formatTokenValue(amountIn, tokenInDecimals as number | undefined);
    const amountOutFormatted = formatTokenValue(amountOut, tokenOutDecimals as number | undefined);

    const summary = `${amountInFormatted ?? amountIn.toString()} ${tokenInSymbol ?? tokenIn} → ${amountOutFormatted ?? amountOut.toString()} ${tokenOutSymbol ?? tokenOut} (fee=${fee / 10000}%)`;

    return {
      id: crypto.randomUUID(),
      ok: true,
      result: {
        tokenIn,
        tokenOut,
        tokenInSymbol: tokenInSymbol ?? null,
        tokenOutSymbol: tokenOutSymbol ?? null,
        feeTier: fee,
        amountIn: amountIn.toString(),
        amountInFormatted,
        amountOut: amountOut.toString(),
        amountOutFormatted,
        gasEstimate: gasEstimate.toString(),
        summary,
        quoterAddress
      },
      meta: {
        chain: params.chain,
        chainId: getChainConfig(params.chain).chainId,
        timestamp: new Date().toISOString()
      }
    };
  } catch (error) {
    throw new AcpError("QUOTE_FAILED", "Uniswap V3 quote simulation failed.", {
      reason: error instanceof Error ? error.message : String(error),
      hint: "Check that a pool exists for this token pair and fee tier."
    });
  }
}

// ─── Registry Add ─────────────────────────────────────────────────────────────

export async function registryAdd(
  params: RegistryAddParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  if (!Array.isArray(params.entries) || params.entries.length === 0) {
    throw new AcpError("INVALID_PARAMS", "registry.add requires a non-empty entries array.");
  }
  for (const entry of params.entries) {
    if (!entry.chain || !entry.protocol || !entry.category || !entry.name) {
      throw new AcpError(
        "INVALID_ENTRY",
        "Each registry entry must have chain, protocol, category, and name.",
        { entry }
      );
    }
  }
  addRegistryEntries(params.entries);
  logger.info("registry.add", { count: params.entries.length });
  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      added: params.entries.length,
      entries: params.entries,
      summary: `Added ${params.entries.length} entr${params.entries.length === 1 ? "y" : "ies"} to the registry.`
    },
    meta: { timestamp: new Date().toISOString() }
  };
}

export const methodHandlers = {
  "registry.lookup": registryLookup,
  "registry.add": registryAdd,
  "token.balance": tokenBalance,
  "aave.positions": aavePositions,
  "compound.positions": compoundPositions,
  "uniswap.quote": uniswapQuote,
  "action.plan": actionPlan,
  "contract.inspect": contractInspect,
  "contract.functions": contractFunctions,
  "contract.describe": contractDescribe,
  "contract.read": contractRead,
  "batch.read": batchRead,
  "contract.simulate": contractSimulate,
  "tx.build": txBuild,
  "tx.send": txSend,
  "receipt.decode": receiptDecode
} as const;
