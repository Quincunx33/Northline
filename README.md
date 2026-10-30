# Northline

Local 3-axis G-code inspector. Parsing, motion, arc math, risk checks, and time estimates run in a Rust engine compiled to WebAssembly. The browser does not upload the program.

This app uses TanStack Start (the preview runtime). It is not a Next.js project.

## What it will and will not do

Interpreted: G0 G1 G2 G3, G17–G19, G20 G21, G90 G91, G90.1 G91.1, G93 G94, F S, M3 M4 M5, M2 M30, comments.

Not applied, and flagged: work offsets, homing, cutter compensation, tool length, canned cycles, macros, extra axes, dwell. There is no stock, fixture, or holder model, and no link to a machine.

Profiles named “illustrative” are teaching numbers, not vendor specifications.

Times are estimates. Path playback is geometric. Neither one is a control replay.

## Engine

```text
rust-engine/          Rust library and wasm crate
src/lib/wasm/pkg/     browser bindings (wasm-bindgen --target web)
src/lib/wasm/pkg-node node bindings used by the integration test
```

Rebuild the browser package after engine changes:

```text
cargo test --manifest-path rust-engine/Cargo.toml --lib
cargo build --release --target wasm32-unknown-unknown --manifest-path rust-engine/Cargo.toml
wasm-bindgen --target web --out-dir src/lib/wasm/pkg rust-engine/target/wasm32-unknown-unknown/release/cnc_engine.wasm
wasm-bindgen --target nodejs --out-dir src/lib/wasm/pkg-node rust-engine/target/wasm32-unknown-unknown/release/cnc_engine.wasm
```

`wasm-bindgen-cli` must match crate `0.2.100`.

## Checks

```text
node --test src/lib/wasm/engine.test.mjs
node --experimental-strip-types --test src/lib/simulate.test.ts
npm run typecheck
npm run build
```

The dev server is `npm run dev` on port 8080.
