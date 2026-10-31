<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,50:0e7490,100:22d3ee&height=210&section=header&text=NORTHLINE&fontSize=60&fontColor=ffffff&fontAlignY=36&desc=Inspect%20G-code.%20Explore%20every%20move.&descSize=18&descAlignY=59" alt="Northline — G-code Inspector" width="100%" />

### A smarter way to explore CNC G-code.

**A privacy-first, browser-based 3-axis G-code inspector with interactive 3D toolpaths, diagnostics, and machining-time estimates.**

[![React](https://img.shields.io/badge/React-19-149eca?style=for-the-badge&logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![WebAssembly](https://img.shields.io/badge/WebAssembly-654FF0?style=for-the-badge&logo=webassembly&logoColor=white)](https://webassembly.org/)

**Local processing** · **3D visualization** · **No machine connection**

</div>

---

## ✨ What is Northline?

**Northline** helps you understand a CNC program *before* running it on a machine. Open a G-code file, follow its toolpath in 3D, examine warnings, and get an approximate machining time — all from your browser.

The inspection engine runs locally using **Rust compiled to WebAssembly**. Your G-code program is **not uploaded for inspection**.

## ⚡ Highlights

| Feature | What it does |
| :--- | :--- |
| 🧊 **Interactive 3D viewer** | Explore the toolpath from different angles. |
| ▶️ **Toolpath playback** | Play, pause, scrub, and step through moves. |
| 🔎 **G-code inspection** | Review parsed commands, errors, and warnings. |
| ⏱️ **Time estimates** | Get an approximate machining duration. |
| ⚙️ **Machine profiles** | Explore the program using selectable machine settings. |
| 📱 **Responsive workspace** | Use tailored layouts on desktop, tablet, and mobile. |
| 🔒 **Privacy-first engine** | Parse and inspect G-code locally in the browser. |

## 🚀 Quick Start

**You'll need:** Node.js and npm.

\`\`\`bash
# Clone the project
git clone https://github.com/Quincunx33/g-code-inspector.git

# Enter the project
cd g-code-inspector

# Install dependencies
npm install

# Start the development server
npm run dev
\`\`\`

Open **http://localhost:3000** in your browser.

## 🧭 How It Works

\`\`\`text
  Open a G-code file
          ↓
   Inspect the moves
          ↓
   Explore the 3D path
          ↓
  Review warnings & time
\`\`\`

1. **Open** a \`.gcode\`, \`.nc\`, \`.tap\`, \`.cnc\`, or \`.txt\` file — or load a built-in sample.
2. **Explore** its geometry with the interactive 3D viewer.
3. **Inspect** the source, reported findings, and estimated machining time.
4. **Play back** the path to follow the sequence of movements.

**Keyboard shortcuts:** \`Space\` to play/pause · \`←\` / \`→\` to step backward/forward.

## 🧰 Under the Hood

<div align="center">

| Frontend | Inspection engine | 3D & styling |
| :---: | :---: | :---: |
| React · TypeScript · TanStack Start | Rust · WebAssembly | Three.js · React Three Fiber · Tailwind CSS |

</div>

The Rust engine handles parsing, motion and arc calculations, inspection checks, and time estimation. The frontend presents the findings and toolpath in an interactive workspace.

## 📐 G-code Coverage

**Interpreted:** \`G0\`, \`G1\`, \`G2\`, \`G3\`, \`G17–G19\`, \`G20\`, \`G21\`, \`G90\`, \`G91\`, \`G90.1\`, \`G91.1\`, \`G93\`, \`G94\`, feed and spindle values, \`M3–M5\`, \`M2\`, \`M30\`, and comments.

**Flagged, not applied:** work offsets, homing, cutter compensation, tool length compensation, canned cycles, macros, extra axes, and dwell.

Northline focuses on a **3-axis milling subset**, not every CNC controller dialect.

<details>
<summary><strong>🛠️ Developer commands & Rust engine build</strong></summary>

Check the application:

\`\`\`bash
npm run typecheck
npm run build
\`\`\`

After editing the Rust engine, test and rebuild its WebAssembly bindings:

\`\`\`bash
cargo test --manifest-path rust-engine/Cargo.toml --lib
cargo build --release --target wasm32-unknown-unknown --manifest-path rust-engine/Cargo.toml

wasm-bindgen --target web --out-dir src/lib/wasm/pkg rust-engine/target/wasm32-unknown-unknown/release/cnc_engine.wasm
wasm-bindgen --target nodejs --out-dir src/lib/wasm/pkg-node rust-engine/target/wasm32-unknown-unknown/release/cnc_engine.wasm
\`\`\`

The \`wasm-bindgen-cli\` version must match **0.2.100** used by the Rust crate.

</details>

## ⚠️ Important Safety Note

> [!CAUTION]
> **Northline is an inspection aid, not a machine controller or safety-certified simulator.**
> Playback is geometric, machining times are estimates, and no machine, stock, fixture, or tool-holder collision model is provided. Always verify a program using your machine manufacturer's approved simulation, setup, and safety procedures before machining.

---

<div align="center">

**Built with care by [Quincunx33](https://github.com/Quincunx33)**

*Understand the code. Visualize the motion. Inspect with confidence.*

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0f172a,50:0e7490,100:22d3ee&height=100&section=footer" alt="" width="100%" />

</div>
