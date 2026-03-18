# Security Policy

`AgentRail` is designed to help agents interact with onchain systems more safely, but it still operates in a high-risk environment.

If you use this project for write operations or real funds, treat security as a first-class concern.

## Supported Use

Safer use cases today:

- read-only contract access
- transaction simulation
- transaction building
- receipt decoding
- controlled execution with explicit policy constraints

Higher-risk use cases:

- hot-wallet transaction sending
- open-ended agent autonomy
- unrestricted contract writes
- unlimited approvals

## Reporting A Vulnerability

If you believe you found a security issue, please do not open a public issue first.

Instead, report it privately with:

- a short summary
- affected method or flow
- impact assessment
- reproduction steps if available

Until a dedicated security contact is added, open a private channel through the repository owner or maintainer profile rather than posting full exploit details publicly.

## Security Expectations

Users and integrators should assume:

- contract ABIs may be incomplete or misleading
- protocol semantics may require more context than ABI alone provides
- any write path can fail or behave unexpectedly if policy is too broad
- simulation success does not eliminate all execution risk

## Recommended Operational Practices

- use dedicated wallets for automation
- use strict allowlists for contracts
- set transaction value limits
- block dangerous approval patterns where possible
- require simulation before sending
- log and review all write actions
- start with read-only mode

## Scope Notes

This project aims to reduce agent risk, not eliminate it.

The protocol is safest when used as a constrained execution layer with:

- explicit policies
- limited signers
- narrow protocol scopes
- observable logs and reviews
