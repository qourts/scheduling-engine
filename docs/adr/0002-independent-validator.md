# ADR 0002: Independent hard-constraint validator

Status: accepted (2026-10-27)

## Decision

`validateSchedule` shares only the domain model (inventory, dependency graph, participant model) with the rest of the engine, never any scheduling logic. Every scheduler output must pass it. Violations are typed and carry `certainty` (`definite` or `possible`).

## Consequences

A scheduler bug cannot hide itself. The validator is itself tested with targeted failing fixtures, property-based perturbations, and an end-to-end simulation test that plays out random results on validated dense schedules and checks the actual rest and overlap of every player.
