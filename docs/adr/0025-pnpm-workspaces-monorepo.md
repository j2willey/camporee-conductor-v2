# ADR-0025 — Monorepo tooling: pnpm workspaces

Date: 2026-10-25 · Status: Accepted

**Decision:** the TypeScript monorepo (ADR-0008) uses plain **pnpm workspaces**. Packages live in
`packages/*`, starting with `packages/scoring`. Toolchain is pinned: Node 22 (`.nvmrc` + `mise.toml`),
pnpm via `packageManager` in `package.json`. Root scripts run `typecheck`, `lint` (ESLint + Prettier)
and `test` (Vitest) across all packages, and CI runs them in that order on every PR and push to `main`.
No Turborepo/Nx for now.

**Why:** pnpm's strict `node_modules` catches undeclared dependencies, which keeps
`packages/scoring` honest about having no I/O dependencies. Its workspace protocol links local
packages without publishing. A handful of packages doesn't need a task-graph cache, and adding
Turborepo later is a small change if CI gets slow.

**Notes:** TypeScript is pinned to 6.0.x because typescript-eslint 8.x does not yet support
TypeScript 7. Revisit when it does.
