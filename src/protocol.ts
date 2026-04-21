import type { ResponseEnvelope } from "./types";

export const PROTOCOL_NAME = "AgentRail";
export const PROTOCOL_VERSION = "0.2.0";
export const PROTOCOL_SCHEMA_VERSION = "2026-04-21";

export function withProtocolMeta<T>(response: ResponseEnvelope<T>): ResponseEnvelope<T> {
  return {
    ...response,
    meta: {
      ...response.meta,
      protocol: PROTOCOL_NAME,
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      timestamp: response.meta?.timestamp ?? new Date().toISOString()
    }
  };
}
