# AgentRail

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![Protocol: Agent-native](https://img.shields.io/badge/protocol-agent--native-blue.svg)](#why-this-exists)

`AgentRail` is a protocol layer that lets agents discover, reason about, and execute onchain actions through structured JSON.

The protocol is generic.
It is designed to work across EVM contracts and DeFi protocols, not just one integration.
Aave-specific methods in this repo are examples of higher-level adapters built on top of the same core protocol surface.
Hyperliquid-specific methods extend the same idea to trading-oriented agent workflows like balances, positions, orders, fills, and ledger history.

The goal is simple:

- make onchain actions easier for agents to discover
- make common tasks safer by default
- reduce the amount of ABI / RPC / glue logic an agent has to invent
- return outputs that are small, structured, and easy for models to use

## Why This Exists

Most onchain tooling is built for developers:

- SDKs expect you to know the ABI
- contract calls return raw values, not task-level meaning
- every agent has to rediscover the same steps:
  find contract -> resolve ABI -> read decimals -> format balance -> simulate -> send -> decode receipt

`AgentRail` packages that into a protocol surface designed for agents.

Instead of only offering low-level primitives like `readContract`, it also offers:

- `registry.lookup`
- `token.balance`
- `hyperliquid.account`
- `hyperliquid.placeOrder`
- `hyperliquid.cancelOrder`
- `hyperliquid.modifyOrder`
- `hyperliquid.orders`
- `hyperliquid.trades`
- `hyperliquid.ledger`
- `protocol-specific adapters`
- `action.plan`
- `receipt.decode`

## Why This Is Useful For Agents

Compared with raw contract-call primitives, this protocol adds:

- **ABI flexibility**
  It can use a provided ABI, `abiPath`, explorer/Sourcify discovery, built-in standards, or a minimal function signature plus `returns`.

- **Higher-level methods**
  Agents can ask for `token.balance`, protocol adapters, or planning methods instead of stitching together multiple raw reads.

- **Safer write flows**
  `simulate-first`, signer guards, policy checks, and explicit error advice are built into the protocol surface.

- **Agent-friendly outputs**
  Responses can include `formatted`, `summary`, `highlights`, `bestMatch`, and `effects`, not just raw onchain values.

- **Self-description**
  The protocol exposes `rpc.discover`, `--llms`, and per-method `schema` output.

- **Token-efficient responses**
  CLI and protocol-level output filtering support smaller responses for LLM runtimes.

## FAQ

### How does this fit with existing SDKs and infra?

No.
`AgentRail` is a protocol layer that can sit on top of existing SDKs, clients, and RPC infrastructure.
It is designed for agent workflows, structured outputs, and safer task-level operations rather than replacing lower-level tools.

### Is this only for Aave?

No.
Aave is the first high-level adapter in the repo today, but the protocol itself is generic.
It already supports generic contract reads, simulation, transaction building, sending, and receipt decoding for arbitrary EVM contracts.

### Do I need a full ABI for every read?

Not always.
You can provide a full ABI, an `abiPath`, rely on ABI discovery, or use minimal function-signature mode with `returns`.

### Is it safe to let an agent send transactions?

Safer than handing an agent a raw SDK by default, but still sensitive.
`AgentRail` is built around explicit callers, simulation-first flows, policy checks, and signer isolation.
You should still use dedicated wallets, limits, and allowlists in real deployments.

## What It Can Do

At a high level, AgentRail gives agents three layers of capability:

- generic contract access
- safer transaction execution
- optional protocol-specific adapters for common workflows

Core contract methods:

- `contract.inspect`
- `contract.functions`
- `contract.describe`
- `contract.read`
- `batch.read`
- `contract.simulate`
- `tx.build`
- `tx.send`
- `receipt.decode`

Built-in higher-level methods and adapters today:

- `registry.lookup`
- `token.balance`
- `hyperliquid.account`
- `hyperliquid.balances`
- `hyperliquid.placeOrder`
- `hyperliquid.cancelOrder`
- `hyperliquid.modifyOrder`
- `hyperliquid.orders`
- `hyperliquid.trades`
- `hyperliquid.ledger`
- `aave.positions`
- `action.plan`

`aave.positions` is an example adapter, not the boundary of the protocol.
AgentRail's core contract methods are intended to work across any EVM-based DeFi protocol as long as the contract is reachable and the ABI can be provided or discovered.

## Agent-Friendly Features

- **Aliases**
  `lookup`, `tokenBalance`, `positions`, `plan`, `read`, `simulate`, `build`, `send`, `decode`

- **Manifest and schemas**
  `--llms` and `schema <method>`

- **Protocol-level output shaping**
  `output.paths`, `output.view`, `output.limit`

- **Built-in summaries**
  `summary`, `highlights`, `bestMatch`, `effects`

- **Structured error advice**
  `retryable`, `likelyCauses`, `suggestedNextActions`

## Quick Start

### 1. Install

From npm:

```bash
npm install -g agentrail
```

Run without global install:

```bash
npx agentrail --llms
```

From local source:

```bash
cd /path/to/AgentRail
bun install
bun link
```

After linking, the CLI is available as `agentrail`.
The legacy alias `acp` still works for compatibility.

### 2. Configure Access

For many read-only flows, the built-in public RPC defaults are enough to get started.

If you want custom RPCs, explorer-backed ABI resolution, or transaction signing, configure `.env` from `.env.example` or set the same variables directly in your environment.

For the full environment variable reference, see [docs/configuration.md](./docs/configuration.md).

### 3. Ask The Protocol What It Supports

LLM-friendly manifest:

```bash
agentrail --llms
```

Method schema:

```bash
agentrail schema contract.read
```

### 4. Run A Simple Read

Minimal signature mode, no full ABI required:

```bash
agentrail call read --json '{"chain":"bnb","address":"0x9B00a09492a626678E5A3009982191586C444Df9","function":"balanceOf(address)","args":["0x5f0599dade40b691caaf156ec7dc6121833d58bb"],"returns":["uint256"],"decimals":18}'
```

### 5. Use A Generic Protocol Flow

Look up a known registry entry:

```bash
agentrail call lookup --json '{"chain":"bnb","protocol":"aave","symbol":"WBNB"}'
```

Read a token balance with formatting:

```bash
agentrail call tokenBalance --json '{"chain":"bnb","token":"0x9B00a09492a626678E5A3009982191586C444Df9","owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"}'
```

Read a Hyperliquid account summary:

```bash
agentrail call hlAccount --json '{"user":"0xYourHyperliquidUser"}'
```

Read Hyperliquid fills:

```bash
agentrail call hlTrades --json '{"user":"0xYourHyperliquidUser","limit":20}'
```

Prepare a preview-only Hyperliquid order action:

```bash
agentrail call hlPlaceOrder --json '{"user":"0xYourHyperliquidUser","market":"BTC","side":"buy","size":"0.01","orderType":"market","slippageBps":50}'
```

Sign a preview-generated Hyperliquid action without sending it:

```bash
agentrail call hlSignAction --json '{"signingRequest":{"action":{"type":"order","orders":[{"a":0,"b":true,"p":"100","s":"0.1","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"},"nonce":1700000000000},"policy":{"allowWrites":true,"mode":"unsafe"}}'
```

Simulate an arbitrary DeFi contract call:

```bash
agentrail call simulate --json '{"chain":"bnb","address":"0xYourContract","function":"deposit(uint256,address)","args":["1000000000000000000","0xYourWallet"],"stateMutability":"nonpayable","caller":"0xYourWallet","policy":{"allowWrites":true,"simulationRequired":true}}'
```

### 6. Use A Built-In Protocol Adapter Example

The repo currently includes Aave as one concrete higher-level adapter example:

```bash
agentrail call positions --json '{"chain":"bnb","owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"}'
```

## Case Study: Aave On BNB

One built-in adapter example today is reading Aave supplied positions on BNB:

```bash
agentrail call positions --json '{"chain":"bnb","owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"}' --filter-output result.summary,result.highlights
```

## Hyperliquid Execution Model

Hyperliquid support is intentionally split into stages:

- `hyperliquid.placeOrder`, `hyperliquid.cancelOrder`, `hyperliquid.modifyOrder`
  return normalized preview payloads and `signingRequest` objects.
- `hyperliquid.signAction`
  signs a preview-generated action with `HYPERLIQUID_PRIVATE_KEY`, but does not send it.
- `hyperliquid.sendSignedAction`
  submits a previously signed action to Hyperliquid.

This keeps the default path safer for agents:

1. discover the method with `rpc.discover` or `schema`
2. build a preview action
3. inspect the normalized payload and warnings
4. sign only with explicit unsafe write policy
5. send only in a separately approved step

Minimal sign/send flow:

```bash
agentrail call hlPlaceOrder --json '{"user":"0xYourHyperliquidUser","market":"BTC","side":"buy","size":"0.01","orderType":"market","slippageBps":50}'
```

```bash
agentrail call hlSignAction --json '{"signingRequest":{"action":{"type":"order","orders":[{"a":0,"b":true,"p":"100","s":"0.1","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"},"nonce":1700000000000},"policy":{"allowWrites":true,"mode":"unsafe"}}'
```

```bash
agentrail call hlSendSignedAction --json '{"signedAction":{"action":{"type":"order","orders":[{"a":0,"b":true,"p":"100","s":"0.1","r":false,"t":{"limit":{"tif":"Ioc"}}}],"grouping":"na"},"nonce":1700000000000,"signature":{"r":"0x...","s":"0x...","v":28}},"policy":{"allowWrites":true,"mode":"unsafe"}}'
```

If you only want safe automation for now, stop after `hlPlaceOrder` or `hlSignAction`.

## Protocol Mode

`AgentRail` can also run as a long-lived stdio JSON server for agent runtimes and orchestration systems.

```bash
agentrail serve
```

Minimal discovery request:

```json
{"id":"1","method":"rpc.discover","params":{}}
```

For protocol-level filtering, compact views, and more detailed server examples, see [docs/protocol-mode.md](./docs/protocol-mode.md).

## Safety Model

Write paths are designed to be more agent-safe than raw SDK usage:

- `contract.simulate` before execution
- policy checks
- signer isolation
- explicit `caller`
- receipt decoding
- structured error advice

## Design Principles

- **Structured first**
  JSON in, JSON out.

- **Readable by models**
  Prefer `summary`, `highlights`, `effects`, and `bestMatch` where possible.

- **Flexible ABI resolution**
  `abi` -> `abiPath` -> Sourcify -> explorer -> built-in standards -> minimal function signature mode

- **Higher-level over repeated glue**
  Common tasks should be one method, not six stitched reads.

- **Small outputs matter**
  Agents should be able to request only what they need.

## Current Focus

`AgentRail` is strongest today for:

- contract inspection and simulation
- generic contract reads and token balance queries
- Hyperliquid account, order, trade, and ledger reads for trading agents
- Hyperliquid preview-only order/cancel/modify action building for safer execution planning
- transaction build/send/decode flows
- protocol address lookup
- Aave BNB supply position reads as a current built-in adapter example

## Development

Run tests:

```bash
bun test
```

Run typecheck:

```bash
bun run typecheck
```

Live verification script:

```bash
bun run verify:live
```

Hyperliquid fresh-agent verification:

```bash
bun run verify:hyperliquid
```

Build npm distributable files:

```bash
npm run build
```

## Open Source

- License: [MIT](./LICENSE)
- Contributing guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Project roadmap: [ROADMAP.md](./ROADMAP.md)
- Security policy: [SECURITY.md](./SECURITY.md)

## What’s Next

Good next expansions:

- richer protocol registries
- more high-level methods for DeFi protocols
- better live receipt decoding examples
- stronger protocol-native projections and pagination
- more chain coverage
