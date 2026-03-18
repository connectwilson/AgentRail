# Configuration

`AgentRail` works with built-in public RPC defaults for many read-only flows, but production usage usually benefits from explicit configuration.

You can either:

- copy `.env.example` to `.env`
- export environment variables directly in your shell
- inject them through your deployment environment

## RPC URLs

Supported custom RPC environment variables:

- `BNB_RPC_URL`
- `ETHEREUM_RPC_URL`
- `BASE_RPC_URL`
- `ARBITRUM_RPC_URL`
- `OPTIMISM_RPC_URL`
- `POLYGON_RPC_URL`

## Signer Configuration

For transaction sending:

- `ACP_PRIVATE_KEY`

The project also accepts:

- `PRIVATE_KEY`

Use dedicated wallets and strict policy controls for any write-enabled environment.

## Explorer API Keys

Optional explorer-backed ABI resolution keys:

- `BSCSCAN_API_KEY`
- `ETHERSCAN_API_KEY`
- `BASESCAN_API_KEY`
- `ARBISCAN_API_KEY`
- `OPTIMISTIC_ETHERSCAN_API_KEY`
- `POLYGONSCAN_API_KEY`

These are optional.
They help when ABI resolution needs explorer access and Sourcify or provided ABI data is not enough.
