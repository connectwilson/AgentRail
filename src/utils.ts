import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  decodeEventLog,
  decodeFunctionResult,
  formatUnits,
  getAddress,
  isAddress,
  type Abi,
  type AbiEvent,
  type AbiFunction,
  type Address
} from "viem";
import { AcpError } from "./errors";
import { normalizeAbiJson } from "./abi";

export function normalizeAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new AcpError("INVALID_ADDRESS", `Invalid address: ${address}`);
  }
  return getAddress(address);
}

export async function loadAbiFromPath(abiPath: string): Promise<Abi> {
  if (!existsSync(abiPath)) {
    throw new AcpError("ABI_NOT_FOUND", `ABI file not found: ${abiPath}`);
  }
  const raw = await readFile(abiPath, "utf8");
  return normalizeAbiJson(raw);
}

export function listAbiFunctions(abi: Abi): AbiFunction[] {
  return abi.filter((item): item is AbiFunction => item.type === "function");
}

export function listAbiEvents(abi: Abi): AbiEvent[] {
  return abi.filter((item): item is AbiEvent => item.type === "event");
}

export function resolveFunction(abi: Abi, functionId: string): AbiFunction {
  const functions = listAbiFunctions(abi);
  const match = functions.find((item) => {
    const signature = formatFunctionSignature(item);
    return signature === functionId || item.name === functionId;
  });
  if (!match) {
    throw new AcpError("FUNCTION_NOT_FOUND", `Function not found in ABI: ${functionId}`);
  }
  return match;
}

export function formatFunctionSignature(item: AbiFunction): string {
  const inputs = item.inputs.map((input) => input.type).join(",");
  return `${item.name}(${inputs})`;
}

export function semanticTypeFromInput(
  name: string | undefined,
  solidityType: string
): string {
  if (solidityType === "address") {
    return name?.includes("receiver") || name?.includes("owner") || name?.includes("spender")
      ? "wallet_address"
      : "address";
  }
  if (solidityType.startsWith("uint") || solidityType.startsWith("int")) {
    if (name?.includes("amount") || name?.includes("assets") || name?.includes("shares")) {
      return "token_amount";
    }
    if (name?.includes("deadline")) {
      return "timestamp";
    }
    return "integer";
  }
  if (solidityType === "bool") {
    return "boolean";
  }
  if (solidityType.startsWith("bytes")) {
    return "bytes";
  }
  return solidityType;
}

export function summarizeFunctionRisk(name: string): "low" | "medium" | "high" {
  const lowered = name.toLowerCase();
  if (lowered.includes("approve") || lowered.includes("setapprovalforall")) {
    return "high";
  }
  if (
    lowered.includes("transfer") ||
    lowered.includes("deposit") ||
    lowered.includes("withdraw") ||
    lowered.includes("mint") ||
    lowered.includes("burn")
  ) {
    return "medium";
  }
  return "low";
}

export function formatDisplayValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value, bigintReplacer);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value, bigintReplacer);
  }
  return String(value);
}

export function formatTokenValue(value: unknown, decimals?: number): string | null {
  if (typeof decimals !== "number") {
    return null;
  }
  if (typeof value === "bigint") {
    return formatUnits(value, decimals);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return formatUnits(BigInt(value), decimals);
  }
  return null;
}

export function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

export function decodeRawResult(abi: Abi, functionId: string, data: `0x${string}`) {
  const fn = resolveFunction(abi, functionId);
  return decodeFunctionResult({ abi, functionName: fn.name, data });
}

export function decodeLogWithAbi(params: {
  abi: Abi;
  data: `0x${string}`;
  topics: readonly `0x${string}`[];
}) {
  try {
    if (params.topics.length === 0) {
      return null;
    }
    return decodeEventLog({
      abi: params.abi,
      data: params.data,
      topics: params.topics as [`0x${string}`, ...`0x${string}`[]]
    });
  } catch {
    return null;
  }
}
