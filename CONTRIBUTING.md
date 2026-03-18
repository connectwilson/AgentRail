# Contributing to AgentRail

Thanks for helping improve `AgentRail`.

This project is trying to make onchain interaction easier for agents to discover, plan, execute, and explain.
The best contributions usually improve one of these:

- agent ergonomics
- safety defaults
- protocol coverage
- output clarity
- test coverage

## Development Setup

```bash
bun install
bun run typecheck
bun test
```

Useful commands:

- `bun run src/index.ts --llms`
- `bun run src/index.ts schema aave.positions`
- `bun run verify:live`

## What We Value In Contributions

- Keep JSON input and output stable.
- Prefer additive changes over breaking changes.
- Keep responses small and structured.
- Make high-level methods easier for agents, not harder.
- Add or update tests when behavior changes.

## Preferred Contribution Areas

- new high-level protocol methods
- registry expansions for real protocols
- stronger output shaping and compact views
- safer execution and policy controls
- better receipt decoding and effect extraction
- documentation and examples

## Pull Request Guidelines

Before opening a PR:

1. Make sure `bun run typecheck` passes.
2. Make sure `bun test` passes.
3. Update `README.md` if user-facing behavior changed.
4. Add a short example when you add a new method or output field.

When writing code:

- keep edits focused
- prefer explicit JSON shapes
- avoid hidden behavior that an agent cannot discover
- preserve backward compatibility where possible

## Design Expectations

`AgentRail` is not just a thin SDK wrapper.

When adding features, ask:

- Does this reduce agent glue code?
- Does this make unsafe actions harder?
- Does this make outputs easier to reason about?
- Can the capability be discovered through `rpc.discover`, `--llms`, or `schema`?

If the answer is no, the feature may belong in a lower layer instead of this protocol.

## Reporting Issues

Good bug reports include:

- the command or JSON request
- the chain and contract involved
- the expected result
- the actual result
- whether ABI was provided, inferred, or auto-discovered

## Questions And Ideas

If you are unsure whether something belongs here, open an issue first.
Ideas for new high-level methods and protocol registries are especially welcome.
