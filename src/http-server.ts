/**
 * HTTP REST server for AgentRail.
 *
 * Provides two modes:
 *   - POST /call  — execute any AgentRail method (same as stdio serve mode)
 *   - GET  /health — health check
 *   - GET  /manifest — LLM method manifest
 *   - GET  /schema/:method — method schema
 *
 * Start with:
 *   agentrail http             # default port 4000
 *   agentrail http --port 8080
 *   AGENTRAIL_HTTP_PORT=8080 agentrail http
 *
 * Request format (POST /call):
 *   { "method": "token.balance", "params": { "chain": "ethereum", ... } }
 *
 * CORS and rate limiting are handled here for production use.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { getLlmManifest, getMethodSchema } from "./manifest";
import { logger } from "./logger";
import { bigintReplacer } from "./utils";
import type { RequestEnvelope, ResponseEnvelope } from "./types";

// Inline executeRequest to avoid circular imports — import the handler map directly
import { methodHandlers } from "./methods";
import { asError, getErrorAdvice } from "./errors";

const METHOD_ALIASES: Record<string, string> = {
  registry: "registry.lookup",
  lookup: "registry.lookup",
  tokenBalance: "token.balance",
  positions: "aave.positions",
  aavePositions: "aave.positions",
  compoundPositions: "compound.positions",
  quote: "uniswap.quote",
  uniswapQuote: "uniswap.quote",
  plan: "action.plan",
  inspect: "contract.inspect",
  functions: "contract.functions",
  describe: "contract.describe",
  read: "contract.read",
  batch: "batch.read",
  batchRead: "batch.read",
  simulate: "contract.simulate",
  build: "tx.build",
  send: "tx.send",
  decode: "receipt.decode",
  decodeReceipt: "receipt.decode"
};

// Simple in-process rate limiter: max requests per IP per window
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const ipRequestCounts = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipRequestCounts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRequestCounts.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    return false;
  }
  entry.count++;
  return true;
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0]?.trim() ?? "unknown";
  return req.socket?.remoteAddress ?? "unknown";
}

function setCommonHeaders(res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", process.env["AGENTRAIL_CORS_ORIGIN"] ?? "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, statusCode: number, body: unknown) {
  setCommonHeaders(res);
  const payload = JSON.stringify(body, bigintReplacer);
  res.writeHead(statusCode);
  res.end(payload);
}

async function handleCall(
  body: string
): Promise<ResponseEnvelope> {
  const request = JSON.parse(body) as RequestEnvelope;
  const requestId = request.id ?? crypto.randomUUID();

  if (!request.method || typeof request.method !== "string") {
    return {
      id: requestId,
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Request must include a string method." },
      meta: { timestamp: new Date().toISOString() }
    };
  }

  const resolvedMethod = METHOD_ALIASES[request.method] ?? request.method;
  const handler = methodHandlers[resolvedMethod as keyof typeof methodHandlers];
  if (!handler) {
    return {
      id: requestId,
      ok: false,
      error: { code: "METHOD_NOT_FOUND", message: `Unsupported method: ${request.method}` },
      meta: { timestamp: new Date().toISOString() }
    };
  }

  try {
    const response = (await handler(request.params as never)) as ResponseEnvelope;
    response.id = requestId;
    return response;
  } catch (error) {
    const normalized = asError(error);
    return {
      id: requestId,
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        data: normalized.data,
        advice: getErrorAdvice(normalized)
      },
      meta: { timestamp: new Date().toISOString() }
    };
  }
}

export function createHttpServer(port = 4000) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const ip = getClientIp(req);
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const startMs = Date.now();

    // CORS preflight
    if (method === "OPTIONS") {
      setCommonHeaders(res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting
    if (!checkRateLimit(ip)) {
      jsonResponse(res, 429, { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Retry after 60s." } });
      return;
    }

    try {
      // GET /health
      if (method === "GET" && url === "/health") {
        jsonResponse(res, 200, { ok: true, status: "healthy", version: "0.2.0", timestamp: new Date().toISOString() });
        return;
      }

      // GET /manifest
      if (method === "GET" && url === "/manifest") {
        jsonResponse(res, 200, getLlmManifest());
        return;
      }

      // GET /schema/:method
      if (method === "GET" && url.startsWith("/schema/")) {
        const methodName = decodeURIComponent(url.slice("/schema/".length));
        const schema = getMethodSchema(METHOD_ALIASES[methodName] ?? methodName);
        if (!schema) {
          jsonResponse(res, 404, { ok: false, error: { code: "METHOD_NOT_FOUND", message: `No schema for method: ${methodName}` } });
          return;
        }
        jsonResponse(res, 200, { method: methodName, schema });
        return;
      }

      // POST /call
      if (method === "POST" && url === "/call") {
        const body = await readBody(req);
        if (!body) {
          jsonResponse(res, 400, { ok: false, error: { code: "EMPTY_BODY", message: "Request body is required." } });
          return;
        }
        const response = await handleCall(body);
        jsonResponse(res, response.ok ? 200 : 400, response);
        logger.info("http.call", {
          ip,
          method: (JSON.parse(body) as { method?: string }).method ?? "unknown",
          ok: response.ok,
          durationMs: Date.now() - startMs
        });
        return;
      }

      // 404
      jsonResponse(res, 404, { ok: false, error: { code: "NOT_FOUND", message: `No route: ${method} ${url}` } });
    } catch (error) {
      logger.error("http.unhandled", { ip, url, error: error instanceof Error ? error.message : String(error) });
      jsonResponse(res, 500, { ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
    }
  });

  server.listen(port, () => {
    logger.info("http.server.start", { port });
    process.stderr.write(
      JSON.stringify({ ts: new Date().toISOString(), level: "info", msg: "AgentRail HTTP server started", port }) + "\n"
    );
  });

  return server;
}
