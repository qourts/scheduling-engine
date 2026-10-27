# ADR 0001: TypeScript library with zero runtime dependencies

Status: accepted (2026-10-27)

## Context

The engine must run independently of Supabase and the frontend, integrate later into Qourts Match Control Core, and serve multiple tournaments without duplication.

## Decision

A strict TypeScript ESM library with no runtime dependencies. Plain JSON-compatible inputs and outputs. Development uses TypeScript, Vitest and fast-check only. Configuration validation is hand-written so the error contract (`code`, `path`, `message`, `severity`) is owned by the engine.

## Consequences

Runs in Node services, edge functions or the browser. No solver libraries: the optimizer (milestone 3) will be heuristic. A CP-SAT service can be added behind the strategy interface if needed.
