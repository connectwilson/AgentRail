# AgentRail

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.sh)
[![Protocol: Agent-native](https://img.shields.io/badge/protocol-agent--native-blue.svg)](#why-this-exists)

`AgentRail` is an agent-native protocol for reading, simulating, and executing EVM contract interactions through structured JSON.

It is not trying to replace great SDKs like `viem`.
It sits one layer above them.

The protocol is generic.
It is designed to work across EVM contracts and DeFi protocols, not just one integration.
Aave-specific methods in this repo are examples of higher-level adapters built on top of the same core protocol surface.

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
- protocol-specific adapters
- `action.plan`
- `receipt.decode`

## Why Use This Instead Of Just viem?

`viem` is an excellent SDK.
`AgentRail` uses the same kinds of low-level capabilities, but optimizes for agent workflows.

Compared with direct SDK usage, this protocol adds:

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

### Is this a replacement for viem?

No.
`AgentRail` is a protocol layer that can sit on top of SDKs like `viem`.
It is designed for agent workflows, structured outputs, and safer task-level operations.

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

### 2. Configure RPC URLs

Copy `.env.example` to `.env`, or set the same variables directly in your shell or deployment environment.

Common vars:

- `BNB_RPC_URL`
- `ETHEREUM_RPC_URL`
- `BASE_RPC_URL`
- `ARBITRUM_RPC_URL`
- `OPTIMISM_RPC_URL`
- `POLYGON_RPC_URL`

If you want to broadcast transactions:

- `ACP_PRIVATE_KEY`

Optional explorer API keys:

- `BSCSCAN_API_KEY`
- `ETHERSCAN_API_KEY`
- `BASESCAN_API_KEY`
- `ARBISCAN_API_KEY`
- `OPTIMISTIC_ETHERSCAN_API_KEY`
- `POLYGONSCAN_API_KEY`

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

Simulate an arbitrary DeFi contract call:

```bash
agentrail call simulate --json '{"chain":"bnb","address":"0xYourContract","function":"deposit(uint256,address)","args":["1000000000000000000","0xYourWallet"],"stateMutability":"nonpayable","caller":"0xYourWallet","policy":{"allowWrites":true,"simulationRequired":true}}'
```

### 6. Use A Built-In Protocol Adapter Example

The repo currently includes Aave as one concrete higher-level adapter example:

```bash
agentrail call positions --json '{"chain":"bnb","owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"}'
```

## Case Study: Aave V3 Positions On BNB

`AgentRail` currently includes a built-in registry for known Aave BNB market entries.

That lets an agent do:

1. `registry.lookup` to find a market or aToken
2. `aave.positions` to scan tracked markets
3. read `summary` or `highlights` instead of parsing the full response

Example:

```bash
agentrail call positions --json '{"chain":"bnb","owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"}'
```

Smaller result for agents:

```bash
agentrail call positions --json '{"chain":"bnb","owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"}' --filter-output result.summary,result.highlights
```

## Protocol Mode

You can run `AgentRail` as a long-lived stdio process:

```bash
agentrail serve
```

Every request is one JSON line.
Every response is one JSON line.

Discovery:

```json
{"id":"1","method":"rpc.discover","params":{}}
```

Protocol-level output filtering:

```json
{
  "id":"2",
  "method":"aave.positions",
  "params":{
    "chain":"bnb",
    "owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"
  },
  "output":{
    "paths":["result.summary","result.highlights"]
  }
}
```

Reusable compact view:

```json
{
  "id":"3",
  "method":"aave.positions",
  "params":{
    "chain":"bnb",
    "owner":"0x5f0599dade40b691caaf156ec7dc6121833d58bb"
  },
  "output":{
    "view":"highlights-only",
    "limit":1
  }
}
```

## Output Shaping

CLI-level:

```bash
--filter-output result.summary,result.highlights
```

Protocol-level:

- `output.paths`
- `output.view`
- `output.limit`

Supported views today:

- `summary-only`
- `highlights-only`
- `non-zero-only`

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

- token balance reads
- protocol address lookup
- Aave BNB supply position reads
- contract inspection and simulation
- transaction build/send/decode flows

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
