# Protocol Mode

`AgentRail` can run as a long-lived stdio JSON server for agent runtimes, orchestration systems, and other tools that want a persistent protocol endpoint.

Start the server:

```bash
agentrail serve
```

Each request is one JSON line.
Each response is one JSON line.

## Minimal Discovery

```json
{"id":"1","method":"rpc.discover","params":{}}
```

## Protocol-Level Output Filtering

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

## Reusable Compact View

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
