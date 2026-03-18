import type { Abi } from "viem";
import { AcpError } from "./errors";
import { formatFunctionSignature, resolveFunction } from "./utils";
import type { Policy } from "./types";

const DEFAULT_POLICY: Required<Pick<Policy, "mode" | "allowWrites" | "simulationRequired">> = {
  mode: "safe",
  allowWrites: false,
  simulationRequired: true
};

export function mergePolicy(policy?: Policy): Policy {
  return {
    ...DEFAULT_POLICY,
    ...policy
  };
}

export function assertWriteAllowed(params: {
  abi: Abi;
  functionId: string;
  contractAddress: string;
  value?: string;
  policy?: Policy;
}) {
  const policy = mergePolicy(params.policy);
  const fn = resolveFunction(params.abi, params.functionId);
  const signature = formatFunctionSignature(fn);
  const writes = fn.stateMutability !== "view" && fn.stateMutability !== "pure";

  if (!writes) {
    return;
  }

  if (!policy.allowWrites) {
    throw new AcpError(
      "WRITE_BLOCKED",
      "Writes are blocked by policy. Set policy.allowWrites=true to continue."
    );
  }

  if (policy.approvedContracts && !policy.approvedContracts.includes(params.contractAddress)) {
    throw new AcpError(
      "CONTRACT_NOT_APPROVED",
      "Target contract is not in policy.approvedContracts.",
      { address: params.contractAddress }
    );
  }

  if (policy.blockedFunctions?.includes(signature) || policy.blockedFunctions?.includes(fn.name)) {
    throw new AcpError("FUNCTION_BLOCKED", "Target function is blocked by policy.");
  }

  if (policy.maxValueWei && params.value) {
    const max = BigInt(policy.maxValueWei);
    const requested = BigInt(params.value);
    if (requested > max) {
      throw new AcpError(
        "VALUE_LIMIT_EXCEEDED",
        `Call value ${requested} exceeds policy max ${max}.`
      );
    }
  }
}
