import {
  type Hex,
  type Abi,
  type Address
} from "viem";
import type {
  BatchReadParams,
  ActionPlanParams,
  AavePositionsParams,
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
import { getAaveMarketEntries, lookupRegistry } from "./registry";
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
  const summary = bestMatch
    ? `Found ${entries.length} registry match${entries.length === 1 ? "" : "es"}; best match is ${bestMatch.name}${bestMatch.address ? ` at ${bestMatch.address}` : ""}.`
    : "No registry matches found for the query.";
  return {
    id: crypto.randomUUID(),
    ok: true,
    result: {
      entries,
      count: entries.length,
      bestMatch,
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
  const nonce =
    params.nonce !== undefined
      ? params.nonce
      : await publicClient.getTransactionCount({ address: signerAddress });

  try {
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

export const methodHandlers = {
  "registry.lookup": registryLookup,
  "token.balance": tokenBalance,
  "aave.positions": aavePositions,
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
