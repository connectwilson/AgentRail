import {
  parseSignature,
  type Hex,
  type Abi,
  type Address
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type {
  BatchReadParams,
  ActionPlanParams,
  AavePositionsParams,
  CompoundPositionsParams,
  HyperliquidAccountParams,
  HyperliquidBalancesParams,
  HyperliquidCancelOrderParams,
  HyperliquidLedgerParams,
  HyperliquidModifyOrderParams,
  HyperliquidOrdersParams,
  HyperliquidPlaceOrderParams,
  HyperliquidSendSignedActionParams,
  HyperliquidSignActionParams,
  HyperliquidTradesParams,
  UniswapQuoteParams,
  UniswapPositionsParams,
  WalletPortfolioParams,
  RegistryAddParams,
  ContractFunctionParams,
  ContractParams,
  FunctionStateMutability,
  RegistryLookupParams,
  ReadParams,
  ReceiptDecodeParams,
  ResponseEnvelope,
  SupportedChain,
  TokenBalanceParams,
  TxBuildParams,
  TxSendParams,
  WriteLikeParams
} from "./types";
import { requireAbi, resolveAbi } from "./abi";
import { AcpError, getErrorAdvice } from "./errors";
import { getChainConfig, getHyperliquidConfig } from "./config";
import { assertWriteAllowed, mergePolicy } from "./policy";
import { addRegistryEntries, getAaveMarketEntries, getCompoundMarkets, lookupRegistry, REGISTRY } from "./registry";
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
import {
  getMarginSummary,
  buildHyperliquidL1ActionHash,
  buildHyperliquidL1TypedData,
  getHyperliquidAllMids,
  getPerpPositions,
  getPortfolioSummary,
  getSpotBalances,
  hyperliquidExchange,
  hyperliquidInfo,
  inferHyperliquidAggressivePrice,
  countDecimalPlaces,
  resolveHyperliquidAsset,
  summarizeHyperliquidBalance,
  summarizeHyperliquidFill,
  summarizeHyperliquidHistoricalOrder,
  summarizeHyperliquidLedgerEntry,
  summarizeHyperliquidOpenOrder,
  summarizeHyperliquidPerpPosition
} from "./hyperliquid";

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
  const prepared = await prepareReadContract(params);
  const client = getPublicClient(params.chain);
  const raw = await client.readContract({
    address: prepared.address,
    abi: prepared.abi,
    functionName: prepared.functionName,
    args: prepared.args,
    blockTag: prepared.blockTag,
    blockNumber: prepared.blockNumber
  });

  return {
    raw,
    abiSource: prepared.abiSource
  };
}

async function prepareReadContract(params: ReadParams) {
  const address = normalizeAddress(params.address);
  const standards = await getStandardsIfNeeded(params);
  const abiResult = await getPreferredAbi(params, standards, "view");
  const abi = requireAbi(abiResult);
  const fn = resolveFunction(abi, params.function);

  return {
    address,
    abi,
    functionName: fn.name as string,
    args: (params.args ?? []) as never,
    blockTag:
      typeof params.blockTag === "bigint"
        ? undefined
        : ((params.blockTag ?? "latest") as "latest" | "safe" | "finalized" | "pending"),
    blockNumber: typeof params.blockTag === "bigint" ? params.blockTag : undefined,
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
  const items = new Array<Record<string, unknown>>(params.items.length);
  const prepared = await Promise.all(
    params.items.map(async (item, index) => {
      try {
        return {
          index,
          item,
          prepared: await prepareReadContract(item)
        };
      } catch (error) {
        const normalized = error instanceof AcpError
          ? error
          : new AcpError("READ_FAILED", error instanceof Error ? error.message : String(error));
        items[index] = {
          index,
          ok: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            data: normalized.data,
            advice: getErrorAdvice(normalized)
          }
        };
        return null;
      }
    })
  );

  const ready = prepared.filter(Boolean) as Array<{
    index: number;
    item: ReadParams;
    prepared: Awaited<ReturnType<typeof prepareReadContract>>;
  }>;

  const multicallEligibleGroups = new Map<string, typeof ready>();
  const sequentialReads: typeof ready = [];

  for (const entry of ready) {
    const blockTag = entry.prepared.blockTag;
    const blockNumber = entry.prepared.blockNumber;
    const isMulticallEligible =
      blockNumber === undefined &&
      (blockTag === "latest" || blockTag === "safe" || blockTag === "finalized");

    if (!isMulticallEligible) {
      sequentialReads.push(entry);
      continue;
    }

    const key = `${entry.item.chain}:${blockTag}`;
    const current = multicallEligibleGroups.get(key) ?? [];
    current.push(entry);
    multicallEligibleGroups.set(key, current);
  }

  for (const [, group] of multicallEligibleGroups) {
    if (group.length === 1) {
      sequentialReads.push(group[0]!);
      continue;
    }

    try {
      const client = getPublicClient(group[0]!.item.chain);
      const responses = await client.multicall({
        allowFailure: true,
        blockTag: group[0]!.prepared.blockTag,
        contracts: group.map((entry) => ({
          address: entry.prepared.address,
          abi: entry.prepared.abi,
          functionName: entry.prepared.functionName,
          args: entry.prepared.args
        }))
      });

      responses.forEach((response, offset) => {
        const entry = group[offset]!;
        if (response.status === "success") {
          items[entry.index] = {
            index: entry.index,
            ok: true,
            result: {
              raw: JSON.parse(JSON.stringify(response.result, bigintReplacer)),
              decoded: formatDisplayValue(response.result),
              formatted: formatTokenValue(response.result, entry.item.decimals),
              abiSource: entry.prepared.abiSource
            },
            execution: {
              mode: "multicall"
            }
          };
          return;
        }

        const normalized = new AcpError(
          "READ_FAILED",
          response.error instanceof Error ? response.error.message : "Multicall subrequest failed."
        );
        items[entry.index] = {
          index: entry.index,
          ok: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            advice: getErrorAdvice(normalized)
          },
          execution: {
            mode: "multicall"
          }
        };
      });
    } catch {
      sequentialReads.push(...group);
    }
  }

  const sequentialResults = await Promise.all(
    sequentialReads.map(async (entry) => {
      try {
        const response = await contractRead(entry.item);
        return {
          index: entry.index,
          ok: true,
          result: response.result,
          execution: {
            mode: "single"
          }
        };
      } catch (error) {
        const normalized = error instanceof AcpError
          ? error
          : new AcpError("READ_FAILED", error instanceof Error ? error.message : String(error));
        return {
          index: entry.index,
          ok: false,
          error: {
            code: normalized.code,
            message: normalized.message,
            data: normalized.data,
            advice: getErrorAdvice(normalized)
          },
          execution: {
            mode: "single"
          }
        };
      }
    })
  );

  for (const result of sequentialResults) {
    items[result.index] = result;
  }

  const normalizedItems = items.filter(Boolean) as Array<{
    index: number;
    ok: boolean;
    result?: Record<string, unknown>;
    error?: Record<string, unknown>;
    execution?: {
      mode: "multicall" | "single";
    };
  }>;
  const multicallItemCount = normalizedItems.filter((item) => item.execution?.mode === "multicall").length;
  const singleItemCount = normalizedItems.filter((item) => item.execution?.mode === "single").length;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      items: normalizedItems,
      execution: {
        multicallItemCount,
        singleItemCount,
        strategy:
          multicallItemCount > 0
            ? "multicall-when-possible"
            : "single-read-fallback"
      }
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
  } else if (goal.includes("hyperliquid")) {
    if (goal.includes("cancel")) {
      steps.push({
        type: "preview",
        method: "hyperliquid.cancelOrder",
        purpose: "Prepare and validate a cancel action without signing or sending it."
      });
    } else if (goal.includes("modify") || goal.includes("edit")) {
      steps.push({
        type: "preview",
        method: "hyperliquid.modifyOrder",
        purpose: "Prepare and validate a replacement order action without signing or sending it."
      });
    } else if (goal.includes("order") || goal.includes("buy") || goal.includes("sell")) {
      steps.push({
        type: "preview",
        method: "hyperliquid.placeOrder",
        purpose: "Prepare and validate a Hyperliquid order action without signing or sending it."
      });
      steps.push({
        type: "review",
        method: "hyperliquid.account",
        purpose: "Confirm balances, positions, and account value before later enabling execution."
      });
    } else if (goal.includes("trade") || goal.includes("fill")) {
      steps.push({
        type: "read",
        method: "hyperliquid.trades",
        purpose: "Read recent Hyperliquid fills for the requested user."
      });
    } else if (goal.includes("order")) {
      steps.push({
        type: "read",
        method: "hyperliquid.orders",
        purpose: "Read open and historical Hyperliquid orders for the requested user."
      });
    } else if (goal.includes("deposit") || goal.includes("withdraw") || goal.includes("funding") || goal.includes("ledger")) {
      steps.push({
        type: "read",
        method: "hyperliquid.ledger",
        purpose: "Read funding and non-funding ledger updates for the requested user."
      });
    } else {
      steps.push({
        type: "read",
        method: "hyperliquid.account",
        purpose: "Read the Hyperliquid account summary, balances, and open perp positions."
      });
      steps.push({
        type: "read",
        method: "hyperliquid.orders",
        purpose: "Optionally inspect open and historical orders for the account."
      });
    }
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

// ─── Uniswap V3 LP Positions ──────────────────────────────────────────────────

const NFT_POSITION_MANAGER_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" }
    ]
  }
] as const;

const DEFAULT_NFT_POSITION_MANAGER: Partial<Record<SupportedChain, string>> = {
  ethereum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  arbitrum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  optimism: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  polygon:  "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  base:     "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f3"
};

export async function uniswapPositions(
  params: UniswapPositionsParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const managerAddress =
    params.positionManagerAddress ?? DEFAULT_NFT_POSITION_MANAGER[params.chain];
  if (!managerAddress) {
    throw new AcpError(
      "POSITION_MANAGER_NOT_FOUND",
      `No Uniswap V3 NonfungiblePositionManager address known for chain '${params.chain}'. Provide positionManagerAddress explicitly.`
    );
  }

  const client = getPublicClient(params.chain);
  const owner = normalizeAddress(params.owner);
  const manager = normalizeAddress(managerAddress);

  const nftCount = await client.readContract({
    address: manager,
    abi: NFT_POSITION_MANAGER_ABI,
    functionName: "balanceOf",
    args: [owner]
  });

  const count = Number(nftCount);
  const MAX_POSITIONS = 50;
  const fetchCount = Math.min(count, MAX_POSITIONS);

  const tokenIds = await Promise.all(
    Array.from({ length: fetchCount }, (_, i) =>
      client.readContract({
        address: manager,
        abi: NFT_POSITION_MANAGER_ABI,
        functionName: "tokenOfOwnerByIndex",
        args: [owner, BigInt(i)]
      })
    )
  );

  const positions = await Promise.all(
    tokenIds.map(async (tokenId) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pos: any = await client.readContract({
          address: manager,
          abi: NFT_POSITION_MANAGER_ABI,
          functionName: "positions",
          args: [tokenId]
        });

        const token0: Address = pos.token0 ?? pos[2];
        const token1: Address = pos.token1 ?? pos[3];
        const fee: number = pos.fee ?? pos[4];
        const liquidity: bigint = pos.liquidity ?? pos[7];
        const tokensOwed0: bigint = pos.tokensOwed0 ?? pos[10];
        const tokensOwed1: bigint = pos.tokensOwed1 ?? pos[11];

        const [sym0, sym1, dec0, dec1] = await Promise.all([
          client.readContract({ address: token0, abi: STANDARD_ABIS.ERC20, functionName: "symbol", args: [] }).catch(() => "?") as Promise<string>,
          client.readContract({ address: token1, abi: STANDARD_ABIS.ERC20, functionName: "symbol", args: [] }).catch(() => "?") as Promise<string>,
          client.readContract({ address: token0, abi: STANDARD_ABIS.ERC20, functionName: "decimals", args: [] }).catch(() => 18) as Promise<number>,
          client.readContract({ address: token1, abi: STANDARD_ABIS.ERC20, functionName: "decimals", args: [] }).catch(() => 18) as Promise<number>
        ]);

        const hasLiquidity = liquidity > 0n;
        const hasUncollectedFees = tokensOwed0 > 0n || tokensOwed1 > 0n;

        return {
          tokenId: tokenId.toString(),
          token0,
          token1,
          token0Symbol: sym0,
          token1Symbol: sym1,
          pair: `${sym0}/${sym1}`,
          fee,
          feeTier: `${fee / 10000}%`,
          liquidity: liquidity.toString(),
          hasLiquidity,
          uncollectedFees: {
            token0Raw: tokensOwed0.toString(),
            token0Formatted: formatTokenValue(tokensOwed0, dec0),
            token0Symbol: sym0,
            token1Raw: tokensOwed1.toString(),
            token1Formatted: formatTokenValue(tokensOwed1, dec1),
            token1Symbol: sym1
          },
          hasUncollectedFees
        };
      } catch (error) {
        return {
          tokenId: tokenId.toString(),
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );

  const activePositions = positions.filter(
    (p) => !("error" in p) && (p.hasLiquidity || p.hasUncollectedFees)
  );

  const summary =
    count === 0
      ? `No Uniswap V3 LP positions found for ${params.owner} on ${params.chain}.`
      : `Found ${count} Uniswap V3 LP NFT${count === 1 ? "" : "s"} for ${params.owner} on ${params.chain}; ${activePositions.length} active (liquidity or uncollected fees).`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      owner: params.owner,
      protocol: "uniswap",
      version: "v3",
      positionManagerAddress: managerAddress,
      totalPositionCount: count,
      fetchedCount: fetchCount,
      activePositionCount: activePositions.length,
      summary,
      highlights: activePositions.map(
        (p) => `LP #${p.tokenId}: ${p.pair} fee=${p.feeTier} liquidity=${p.liquidity}`
      ),
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

// ─── Wallet Portfolio (cross-protocol) ───────────────────────────────────────

const NATIVE_SYMBOL: Record<SupportedChain, string> = {
  ethereum: "ETH",
  bnb:      "BNB",
  base:     "ETH",
  arbitrum: "ETH",
  optimism: "ETH",
  polygon:  "MATIC",
  local:    "ETH"
};

export async function walletPortfolio(
  params: WalletPortfolioParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const client = getPublicClient(params.chain);
  const owner = normalizeAddress(params.owner);
  const scan = params.protocols ?? ["aave", "compound", "uniswap", "tokens"];

  // Run everything in parallel; capture per-protocol errors gracefully
  const [nativeResult, aaveResult, compoundResult, uniswapResult, tokenResults] =
    await Promise.all([
      // Native coin balance
      client
        .getBalance({ address: owner })
        .then((bal) => ({
          balanceRaw: bal.toString(),
          balanceFormatted: formatTokenValue(bal, 18),
          symbol: NATIVE_SYMBOL[params.chain],
          nonZero: bal > 0n
        }))
        .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })),

      // Aave V3
      scan.includes("aave")
        ? aavePositions({ chain: params.chain, owner: params.owner })
            .then((r) => r.result ?? null)
            .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        : Promise.resolve(null),

      // Compound V3
      scan.includes("compound")
        ? compoundPositions({ chain: params.chain, owner: params.owner })
            .then((r) => r.result ?? null)
            .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        : Promise.resolve(null),

      // Uniswap V3 LP
      scan.includes("uniswap")
        ? uniswapPositions({ chain: params.chain, owner: params.owner })
            .then((r) => r.result ?? null)
            .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
        : Promise.resolve(null),

      // Registered ERC20 balances for this chain
      scan.includes("tokens")
        ? (async () => {
            const registryTokens = REGISTRY.filter(
              (e) => e.chain === params.chain && e.category === "token" && e.address
            );
            const balances = await Promise.all(
              registryTokens.map(async (token) => {
                try {
                  const bal = await client.readContract({
                    address: normalizeAddress(token.address!),
                    abi: STANDARD_ABIS.ERC20,
                    functionName: "balanceOf",
                    args: [owner]
                  }) as bigint;
                  const decimals = Number(token.metadata?.decimals ?? 18);
                  return {
                    symbol: token.symbol ?? token.name,
                    address: token.address,
                    balanceRaw: bal.toString(),
                    balanceFormatted: formatTokenValue(bal, decimals),
                    decimals,
                    nonZero: bal > 0n
                  };
                } catch {
                  return null;
                }
              })
            );
            return balances.filter(Boolean);
          })()
        : Promise.resolve([])
    ]);

  // Build a clean highlights list
  const highlights: string[] = [];

  if ("balanceFormatted" in nativeResult && nativeResult.nonZero) {
    highlights.push(`${nativeResult.balanceFormatted} ${nativeResult.symbol} (native)`);
  }

  const nonZeroTokens = (tokenResults as Array<{ symbol: string; balanceFormatted: string | undefined; nonZero: boolean } | null>)
    .filter((t): t is NonNullable<typeof t> => t !== null && t.nonZero);
  for (const tok of nonZeroTokens) {
    highlights.push(`${tok.balanceFormatted ?? tok.symbol} ${tok.symbol}`);
  }

  if (aaveResult && "nonZeroPositions" in aaveResult && Array.isArray(aaveResult.nonZeroPositions) && aaveResult.nonZeroPositions.length > 0) {
    highlights.push(`Aave V3: ${aaveResult.nonZeroPositions.length} supply position(s)`);
  }

  if (compoundResult && "activePositions" in compoundResult && Array.isArray(compoundResult.activePositions) && compoundResult.activePositions.length > 0) {
    highlights.push(`Compound V3: ${compoundResult.activePositions.length} active position(s)`);
  }

  if (uniswapResult && "activePositionCount" in uniswapResult && Number(uniswapResult.activePositionCount) > 0) {
    highlights.push(`Uniswap V3: ${uniswapResult.activePositionCount} active LP position(s)`);
  }

  const nonEmptyProtocols: string[] = [];
  if ("nonZero" in nativeResult && nativeResult.nonZero) nonEmptyProtocols.push("native");
  if (nonZeroTokens.length > 0) nonEmptyProtocols.push("tokens");
  if (aaveResult && "nonZeroPositions" in aaveResult && Array.isArray(aaveResult.nonZeroPositions) && aaveResult.nonZeroPositions.length > 0) nonEmptyProtocols.push("aave");
  if (compoundResult && "activePositions" in compoundResult && Array.isArray(compoundResult.activePositions) && compoundResult.activePositions.length > 0) nonEmptyProtocols.push("compound");
  if (uniswapResult && "activePositionCount" in uniswapResult && Number(uniswapResult.activePositionCount) > 0) nonEmptyProtocols.push("uniswap");

  const summary =
    highlights.length === 0
      ? `No assets found for ${params.owner} on ${params.chain} across scanned protocols (${scan.join(", ")}).`
      : `${params.owner} on ${params.chain} — ${highlights.join("; ")}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      owner: params.owner,
      chain: params.chain,
      scannedProtocols: scan,
      nonEmptyProtocols,
      nativeBalance: nativeResult,
      tokens: tokenResults,
      protocols: {
        aave: aaveResult,
        compound: compoundResult,
        uniswap: uniswapResult
      },
      highlights,
      summary
    },
    meta: {
      chain: params.chain,
      chainId: getChainConfig(params.chain).chainId,
      timestamp: new Date().toISOString()
    }
  };
}

// ─── Hyperliquid (read-only adapter family) ──────────────────────────────────

function defaultHyperliquidWindowMs(days = 30) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

export async function hyperliquidAccount(
  params: HyperliquidAccountParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const includePerps = params.includePerps ?? true;
  const includeSpot = params.includeSpot ?? true;
  const includePortfolio = params.includePortfolio ?? true;
  const includeRole = params.includeRole ?? true;
  const includeVaults = params.includeVaults ?? true;

  const [perpState, spotState, portfolio, role, vaults] = await Promise.all([
    includePerps
      ? hyperliquidInfo<Record<string, unknown>>({
          type: "clearinghouseState",
          user: params.user,
          ...(params.dex ? { dex: params.dex } : {})
        })
      : Promise.resolve(null),
    includeSpot
      ? hyperliquidInfo<Record<string, unknown>>({
          type: "spotClearinghouseState",
          user: params.user
        })
      : Promise.resolve(null),
    includePortfolio
      ? hyperliquidInfo<Record<string, unknown>>({
          type: "portfolio",
          user: params.user
        })
      : Promise.resolve(null),
    includeRole
      ? hyperliquidInfo<Record<string, unknown>>({
          type: "userRole",
          user: params.user
        })
      : Promise.resolve(null),
    includeVaults
      ? hyperliquidInfo<unknown[]>({
          type: "userVaultEquities",
          user: params.user
        })
      : Promise.resolve(null)
  ]);

  const spotBalances = spotState ? getSpotBalances(spotState).map(summarizeHyperliquidBalance) : [];
  const nonZeroSpotBalances = spotBalances.filter((balance) => {
    const total = balance.total ? Number(balance.total) : 0;
    return Number.isFinite(total) && total !== 0;
  });

  const perpPositions = perpState ? getPerpPositions(perpState).map(summarizeHyperliquidPerpPosition) : [];
  const activePerpPositions = perpPositions.filter((position) => {
    const size = position.size ? Number(position.size) : 0;
    return Number.isFinite(size) && size !== 0;
  });

  const marginSummary = perpState ? getMarginSummary(perpState) : {};
  const portfolioSummary = portfolio ? getPortfolioSummary(portfolio) : {};
  const vaultEquities = Array.isArray(vaults) ? vaults : [];

  const highlights: string[] = [];
  const accountValue =
    (marginSummary["accountValue"] as string | undefined) ??
    (portfolioSummary["accountValue"] as string | undefined) ??
    (portfolioSummary["portfolioValue"] as string | undefined);
  const withdrawable =
    (marginSummary["withdrawable"] as string | undefined) ??
    (portfolioSummary["withdrawable"] as string | undefined);

  if (accountValue) {
    highlights.push(`accountValue=${accountValue} USDC`);
  }
  if (withdrawable) {
    highlights.push(`withdrawable=${withdrawable} USDC`);
  }
  for (const balance of nonZeroSpotBalances.slice(0, 3)) {
    highlights.push(`${balance.total ?? "0"} ${balance.coin}`);
  }
  if (activePerpPositions.length > 0) {
    highlights.push(`perps=${activePerpPositions.length} active position(s)`);
  }
  if (vaultEquities.length > 0) {
    highlights.push(`vaults=${vaultEquities.length}`);
  }

  const summary =
    highlights.length === 0
      ? `No active Hyperliquid balances or positions found for ${params.user}.`
      : `Hyperliquid account ${params.user} — ${highlights.join("; ")}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      user: params.user,
      dex: params.dex ?? null,
      role,
      marginSummary,
      portfolio: portfolioSummary,
      spotBalances,
      nonZeroSpotBalances,
      perpPositions,
      activePerpPositions,
      vaultEquities,
      highlights,
      summary,
      raw: {
        clearinghouseState: perpState,
        spotClearinghouseState: spotState,
        portfolio,
        vaults
      }
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidBalances(
  params: HyperliquidBalancesParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const account = await hyperliquidAccount({
    user: params.user,
    dex: params.dex,
    includePerps: true,
    includeSpot: true,
    includePortfolio: true,
    includeRole: false,
    includeVaults: false
  });

  const result = account.result as Record<string, unknown>;
  const spotBalances = Array.isArray(result.nonZeroSpotBalances)
    ? result.nonZeroSpotBalances
    : [];
  const activePerpPositions = Array.isArray(result.activePerpPositions)
    ? result.activePerpPositions
    : [];

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      user: params.user,
      dex: params.dex ?? null,
      spotBalances,
      activePerpPositions,
      highlights: Array.isArray(result.highlights) ? result.highlights : [],
      summary: result.summary
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidOrders(
  params: HyperliquidOrdersParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const includeOpen = params.includeOpen ?? true;
  const includeHistorical = params.includeHistorical ?? true;
  const limit = params.limit ?? 50;

  const [openOrdersRaw, historicalOrdersRaw] = await Promise.all([
    includeOpen
      ? hyperliquidInfo<unknown[]>({
          type: "frontendOpenOrders",
          user: params.user,
          ...(params.dex ? { dex: params.dex } : {})
        })
      : Promise.resolve([]),
    includeHistorical
      ? hyperliquidInfo<unknown[]>({
          type: "historicalOrders",
          user: params.user
        })
      : Promise.resolve([])
  ]);

  const openOrders = (Array.isArray(openOrdersRaw) ? openOrdersRaw : [])
    .map((item) => summarizeHyperliquidOpenOrder(item as Record<string, unknown>))
    .slice(0, limit);
  const historicalOrders = (Array.isArray(historicalOrdersRaw) ? historicalOrdersRaw : [])
    .map((item) => summarizeHyperliquidHistoricalOrder(item as Record<string, unknown>))
    .slice(0, limit);

  const highlights = [
    openOrders.length > 0 ? `open=${openOrders.length}` : null,
    historicalOrders.length > 0 ? `historical=${historicalOrders.length}` : null
  ].filter(Boolean);

  const summary =
    highlights.length === 0
      ? `No Hyperliquid orders found for ${params.user}.`
      : `Hyperliquid orders for ${params.user} — ${highlights.join("; ")}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      user: params.user,
      dex: params.dex ?? null,
      openOrdersCount: openOrders.length,
      historicalOrdersCount: historicalOrders.length,
      openOrders,
      historicalOrders,
      highlights,
      summary,
      raw: {
        openOrders: openOrdersRaw,
        historicalOrders: historicalOrdersRaw
      }
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidTrades(
  params: HyperliquidTradesParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const limit = params.limit ?? 100;
  const startTime = params.startTime ?? defaultHyperliquidWindowMs(30);
  const payload =
    params.startTime || params.endTime
      ? {
          type: "userFillsByTime",
          user: params.user,
          startTime,
          ...(params.endTime ? { endTime: params.endTime } : {})
        }
      : {
          type: "userFills",
          user: params.user
        };

  const fillsRaw = await hyperliquidInfo<unknown[]>(payload);
  const fills = (Array.isArray(fillsRaw) ? fillsRaw : [])
    .map((fill) => summarizeHyperliquidFill(fill as Record<string, unknown>))
    .slice(0, limit);

  const highlights = fills.slice(0, 5).map((fill) => {
    const dir = fill.direction ?? fill.side ?? "fill";
    return `${dir} ${fill.size ?? "?"} ${fill.coin ?? "asset"} @ ${fill.price ?? "?"}`;
  });

  const summary =
    fills.length === 0
      ? `No Hyperliquid fills found for ${params.user} in the requested window.`
      : `Found ${fills.length} Hyperliquid fill${fills.length === 1 ? "" : "s"} for ${params.user}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      user: params.user,
      startTime,
      endTime: params.endTime ?? null,
      fillsCount: fills.length,
      fills,
      highlights,
      summary,
      raw: fillsRaw
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidLedger(
  params: HyperliquidLedgerParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const includeFunding = params.includeFunding ?? true;
  const includeNonFunding = params.includeNonFunding ?? true;
  const startTime = params.startTime ?? defaultHyperliquidWindowMs(30);
  const endTime = params.endTime;
  const limit = params.limit ?? 100;

  const [fundingRaw, nonFundingRaw] = await Promise.all([
    includeFunding
      ? hyperliquidInfo<unknown[]>({
          type: "userFunding",
          user: params.user,
          startTime,
          ...(endTime ? { endTime } : {})
        })
      : Promise.resolve([]),
    includeNonFunding
      ? hyperliquidInfo<unknown[]>({
          type: "userNonFundingLedgerUpdates",
          user: params.user,
          startTime,
          ...(endTime ? { endTime } : {})
        })
      : Promise.resolve([])
  ]);

  const funding = (Array.isArray(fundingRaw) ? fundingRaw : [])
    .map((entry) => summarizeHyperliquidLedgerEntry(entry as Record<string, unknown>))
    .slice(0, limit);
  const nonFunding = (Array.isArray(nonFundingRaw) ? nonFundingRaw : [])
    .map((entry) => summarizeHyperliquidLedgerEntry(entry as Record<string, unknown>))
    .slice(0, limit);

  const highlights = [
    funding.length > 0 ? `funding=${funding.length}` : null,
    nonFunding.length > 0 ? `nonFunding=${nonFunding.length}` : null
  ].filter(Boolean);

  const summary =
    highlights.length === 0
      ? `No Hyperliquid ledger updates found for ${params.user} in the requested window.`
      : `Hyperliquid ledger for ${params.user} — ${highlights.join("; ")}.`;

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      user: params.user,
      startTime,
      endTime: endTime ?? null,
      fundingCount: funding.length,
      nonFundingCount: nonFunding.length,
      funding,
      nonFunding,
      highlights,
      summary,
      raw: {
        funding: fundingRaw,
        nonFunding: nonFundingRaw
      }
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

function buildHyperliquidOrderPayload(params: {
  asset: number;
  side: "buy" | "sell";
  size: string;
  price: string;
  tif: "Alo" | "Ioc" | "Gtc";
  reduceOnly?: boolean;
  clientOrderId?: string;
}) {
  return {
    a: params.asset,
    b: params.side === "buy",
    p: params.price,
    s: params.size,
    r: params.reduceOnly ?? false,
    t: {
      limit: {
        tif: params.tif
      }
    },
    ...(params.clientOrderId ? { c: params.clientOrderId } : {})
  };
}

function buildHyperliquidPreviewWarnings(params: {
  market: string;
  orderType: "limit" | "market";
  providedPrice?: string;
  derivedPrice?: string | null;
  slippageBps?: number;
  sizeDecimals?: number;
  size?: string;
}) {
  const warnings: string[] = [
    "Preview-only: this response does not sign or send an order to Hyperliquid."
  ];

  if (params.orderType === "market") {
    warnings.push(
      `Market orders are represented as aggressive IOC limit orders in this preview. Derived reference price uses slippageBps=${params.slippageBps ?? 100}.`
    );
  }

  if (params.sizeDecimals !== undefined && params.size) {
    const places = countDecimalPlaces(params.size);
    if (places > params.sizeDecimals) {
      warnings.push(
        `Size precision may be too fine for ${params.market}: provided ${places} decimal places, market metadata suggests ${params.sizeDecimals}.`
      );
    }
  }

  if (params.providedPrice && params.derivedPrice && params.orderType === "market") {
    warnings.push("Provided price was ignored because market preview derives an aggressive IOC reference price.");
  }

  return warnings;
}

export async function hyperliquidPlaceOrder(
  params: HyperliquidPlaceOrderParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const asset = await resolveHyperliquidAsset(params.market);
  const orderType = params.orderType ?? "limit";
  const tif = params.tif ?? (orderType === "market" ? "Ioc" : "Gtc");
  const mids = await getHyperliquidAllMids();
  const mid = mids[params.market] ?? null;
  const derivedPrice =
    orderType === "market"
      ? inferHyperliquidAggressivePrice({
          side: params.side,
          mid,
          slippageBps: params.slippageBps
        })
      : null;
  const finalPrice = orderType === "market" ? derivedPrice : params.price ?? null;

  if (!finalPrice) {
    throw new AcpError(
      "INVALID_PARAMS",
      "hyperliquid.placeOrder requires price for limit previews, or a resolvable mid price for market previews.",
      { market: params.market, orderType }
    );
  }

  const nonce = Date.now();
  const action = {
    type: "order",
    orders: [
      buildHyperliquidOrderPayload({
        asset: asset.asset,
        side: params.side,
        size: params.size,
        price: finalPrice,
        tif,
        reduceOnly: params.reduceOnly,
        clientOrderId: params.clientOrderId
      })
    ],
    grouping: "na"
  };

  const warnings = buildHyperliquidPreviewWarnings({
    market: params.market,
    orderType,
    providedPrice: params.price,
    derivedPrice,
    slippageBps: params.slippageBps,
    sizeDecimals: asset.szDecimals,
    size: params.size
  });

  return {
    id: crypto.randomUUID(),
    ok: true,
    warnings,
    result: {
      user: params.user,
      market: params.market,
      marketType: asset.marketType,
      asset: asset.asset,
      orderType,
      executionMode: "preview-only",
      price: finalPrice,
      referenceMid: mid,
      side: params.side,
      size: params.size,
      tif,
      reduceOnly: params.reduceOnly ?? false,
      nonce,
      expiresAfter: params.expiresAfter ?? null,
      vaultAddress: params.vaultAddress ?? null,
      action,
      signingRequest: {
        action,
        nonce,
        ...(params.vaultAddress ? { vaultAddress: params.vaultAddress } : {}),
        ...(params.expiresAfter ? { expiresAfter: params.expiresAfter } : {})
      },
      nextSteps: [
        "Review warnings and final normalized order payload.",
        "Sign the Hyperliquid action with the appropriate account key outside AgentRail.",
        "Submit the signed action to the Hyperliquid exchange endpoint in a later write-enabled phase."
      ],
      summary: `Prepared preview-only Hyperliquid ${orderType} ${params.side} order for ${params.size} ${params.market} at ${finalPrice}.`
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidCancelOrder(
  params: HyperliquidCancelOrderParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  const asset = await resolveHyperliquidAsset(params.market);
  if (params.orderId === undefined && !params.clientOrderId) {
    throw new AcpError(
      "INVALID_PARAMS",
      "hyperliquid.cancelOrder requires either orderId or clientOrderId.",
      { market: params.market }
    );
  }

  const nonce = Date.now();
  const action = params.clientOrderId
    ? {
        type: "cancelByCloid",
        cancels: [
          {
            asset: asset.asset,
            cloid: params.clientOrderId
          }
        ]
      }
    : {
        type: "cancel",
        cancels: [
          {
            a: asset.asset,
            o: Number(params.orderId)
          }
        ]
      };

  return {
    id: crypto.randomUUID(),
    ok: true,
    warnings: ["Preview-only: this response does not sign or send a cancel action to Hyperliquid."],
    result: {
      user: params.user,
      market: params.market,
      marketType: asset.marketType,
      asset: asset.asset,
      executionMode: "preview-only",
      cancelTarget: params.clientOrderId
        ? { clientOrderId: params.clientOrderId }
        : { orderId: params.orderId },
      nonce,
      expiresAfter: params.expiresAfter ?? null,
      vaultAddress: params.vaultAddress ?? null,
      action,
      signingRequest: {
        action,
        nonce,
        ...(params.vaultAddress ? { vaultAddress: params.vaultAddress } : {}),
        ...(params.expiresAfter ? { expiresAfter: params.expiresAfter } : {})
      },
      nextSteps: [
        "Confirm the target order id or client order id is correct.",
        "Sign this cancel action with the appropriate Hyperliquid key outside AgentRail.",
        "Submit it to the Hyperliquid exchange endpoint in a later write-enabled phase."
      ],
      summary: `Prepared preview-only Hyperliquid cancel action for ${params.market}.`
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidModifyOrder(
  params: HyperliquidModifyOrderParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  if (params.orderId === undefined && !params.clientOrderId) {
    throw new AcpError(
      "INVALID_PARAMS",
      "hyperliquid.modifyOrder requires either orderId or clientOrderId.",
      { market: params.market }
    );
  }

  const asset = await resolveHyperliquidAsset(params.market);
  const orderType = params.orderType ?? "limit";
  const tif = params.tif ?? (orderType === "market" ? "Ioc" : "Gtc");
  const mids = await getHyperliquidAllMids();
  const mid = mids[params.market] ?? null;
  const derivedPrice =
    orderType === "market"
      ? inferHyperliquidAggressivePrice({
          side: params.side,
          mid,
          slippageBps: params.slippageBps
        })
      : null;
  const finalPrice = orderType === "market" ? derivedPrice : params.price ?? null;

  if (!finalPrice) {
    throw new AcpError(
      "INVALID_PARAMS",
      "hyperliquid.modifyOrder requires price for limit previews, or a resolvable mid price for market previews.",
      { market: params.market, orderType }
    );
  }

  const order = buildHyperliquidOrderPayload({
    asset: asset.asset,
    side: params.side,
    size: params.size,
    price: finalPrice,
    tif,
    reduceOnly: params.reduceOnly,
    clientOrderId: params.newClientOrderId
  });
  const nonce = Date.now();
  const action = params.clientOrderId
    ? {
        type: "modifyByCloid",
        modifies: [
          {
            asset: asset.asset,
            cloid: params.clientOrderId,
            order
          }
        ]
      }
    : {
        type: "modify",
        modifies: [
          {
            oid: Number(params.orderId),
            order
          }
        ]
      };

  const warnings = buildHyperliquidPreviewWarnings({
    market: params.market,
    orderType,
    providedPrice: params.price,
    derivedPrice,
    slippageBps: params.slippageBps,
    sizeDecimals: asset.szDecimals,
    size: params.size
  });

  return {
    id: crypto.randomUUID(),
    ok: true,
    warnings,
    result: {
      user: params.user,
      market: params.market,
      marketType: asset.marketType,
      asset: asset.asset,
      executionMode: "preview-only",
      modifyTarget: params.clientOrderId
        ? { clientOrderId: params.clientOrderId }
        : { orderId: params.orderId },
      normalizedOrder: order,
      referenceMid: mid,
      nonce,
      expiresAfter: params.expiresAfter ?? null,
      vaultAddress: params.vaultAddress ?? null,
      action,
      signingRequest: {
        action,
        nonce,
        ...(params.vaultAddress ? { vaultAddress: params.vaultAddress } : {}),
        ...(params.expiresAfter ? { expiresAfter: params.expiresAfter } : {})
      },
      nextSteps: [
        "Review the normalized replacement order fields.",
        "Sign the modify action with the correct Hyperliquid key outside AgentRail.",
        "Submit the signed action to Hyperliquid in a later write-enabled phase."
      ],
      summary: `Prepared preview-only Hyperliquid modify action for ${params.market}.`
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

function assertHyperliquidWriteAllowed(policy?: WriteLikeParams["policy"]) {
  const merged = mergePolicy(policy);
  if (!merged.allowWrites) {
    throw new AcpError(
      "WRITE_BLOCKED",
      "Hyperliquid signing/sending is blocked by policy. Set policy.allowWrites=true to continue."
    );
  }
  if (merged.mode !== "unsafe") {
    throw new AcpError(
      "WRITE_BLOCKED",
      "Hyperliquid signing/sending requires policy.mode='unsafe' in this phase."
    );
  }
  return merged;
}

export async function hyperliquidSignAction(
  params: HyperliquidSignActionParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  assertHyperliquidWriteAllowed(params.policy);
  const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY ?? process.env.ACP_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new AcpError(
      "SIGNER_MISSING",
      "No Hyperliquid signing key configured. Set HYPERLIQUID_PRIVATE_KEY."
    );
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const { isMainnet } = getHyperliquidConfig();
  const connectionId = buildHyperliquidL1ActionHash({
    action: params.signingRequest.action,
    nonce: params.signingRequest.nonce,
    vaultAddress: params.signingRequest.vaultAddress ?? undefined,
    expiresAfter: params.signingRequest.expiresAfter ?? undefined
  });
  const typedData = buildHyperliquidL1TypedData(connectionId, isMainnet);
  const signatureHex = await account.signTypedData(typedData as never);
  const parsed = parseSignature(signatureHex);

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      user: params.user ?? null,
      executionMode: "signed-but-not-sent",
      signerAddress: account.address,
      connectionId,
      typedData,
      signature: {
        r: parsed.r,
        s: parsed.s,
        v: parsed.v
      },
      signedAction: {
        action: params.signingRequest.action,
        nonce: params.signingRequest.nonce,
        signature: {
          r: parsed.r,
          s: parsed.s,
          v: parsed.v
        },
        vaultAddress: params.signingRequest.vaultAddress ?? null,
        expiresAfter: params.signingRequest.expiresAfter ?? null
      },
      summary: `Signed Hyperliquid action with signer ${account.address}, but did not send it.`
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
}

export async function hyperliquidSendSignedAction(
  params: HyperliquidSendSignedActionParams
): Promise<ResponseEnvelope<Record<string, unknown>>> {
  assertHyperliquidWriteAllowed(params.policy);
  const response = await hyperliquidExchange<Record<string, unknown>>({
    action: params.signedAction.action,
    nonce: params.signedAction.nonce,
    signature: params.signedAction.signature,
    ...(params.signedAction.vaultAddress ? { vaultAddress: params.signedAction.vaultAddress } : {}),
    ...(params.signedAction.expiresAfter ? { expiresAfter: params.signedAction.expiresAfter } : {})
  });

  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      executionMode: "sent",
      sentAction: params.signedAction,
      response,
      summary: "Sent signed Hyperliquid action to the exchange endpoint."
    },
    meta: {
      adapter: "hyperliquid",
      timestamp: new Date().toISOString()
    }
  };
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
  "hyperliquid.account": hyperliquidAccount,
  "hyperliquid.balances": hyperliquidBalances,
  "hyperliquid.orders": hyperliquidOrders,
  "hyperliquid.trades": hyperliquidTrades,
  "hyperliquid.ledger": hyperliquidLedger,
  "hyperliquid.placeOrder": hyperliquidPlaceOrder,
  "hyperliquid.cancelOrder": hyperliquidCancelOrder,
  "hyperliquid.modifyOrder": hyperliquidModifyOrder,
  "hyperliquid.signAction": hyperliquidSignAction,
  "hyperliquid.sendSignedAction": hyperliquidSendSignedAction,
  "aave.positions": aavePositions,
  "compound.positions": compoundPositions,
  "uniswap.quote": uniswapQuote,
  "uniswap.positions": uniswapPositions,
  "wallet.portfolio": walletPortfolio,
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
