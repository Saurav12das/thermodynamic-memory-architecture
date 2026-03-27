# WDMA — Weighted Developmental Memory Architecture

A **one-click, cost-aware, self-evolving memory system** for LLM agents. Built on the [Thermodynamic Memory](docs/THERMODYNAMIC_MEMORY_V1_SPEC.md) framework.

> **Maximize decision quality per unit compute**

## Install & Use (3 lines)

```js
import { createWDMA } from './src/index.js';
const wdma = createWDMA({ persistPath: './data/memory.json' });

wdma.remember({ fact: 'Deploy cadence is weekly', type: 'event' });
const result = await wdma.recall('When do we deploy?');
wdma.feedback(true);
```

## Run the Examples

```bash
npm run example:quickstart    # minimal working demo
npm run example:agent         # full agent loop simulation
```

## What's Inside

### Core Library (`src/`)

| Module | Purpose |
|--------|---------|
| `index.js` | `createWDMA()` factory — wires everything in one call |
| `memory-store.js` | Indexed storage across 4 layers (past, present, culture, future_seed) |
| `ingest-pipeline.js` | I0 gate → I1 extract → I2 resolve → I3 route |
| `retrieval-ladder.js` | R0 cheap → R1 timeline → R2 trust → R3 multi-agent |
| `weight-calculator.js` | W(m) = α·recency + β·relevance + γ·reliability + δ·reinforcement |
| `conflict-resolver.js` | Supersession chains, contradiction detection, audit trail |
| `developmental-stages.js` | REACTIVE → REFLECTIVE → ADAPTIVE → AUTONOMOUS |
| `jolt-encoder.js` | **Jolt encoding** — prediction-error gate with dynamic thresholds |
| `promotion-utility.js` | **U(m)** = αR + βN + γC + δV - λA with L0–L5 typed layer routing |
| `verification-gate.js` | **Correctness gate** — temporal, source, contradiction checks |
| `d0-d5-benchmark.js` | **D0–D5 taxonomy** — synthetic benchmark generator (6 difficulty levels) |
| `failure-mitigations.js` | Disconfirmation bonus, staleness penalty, probationary routing |

### Evaluation Harness (`eval/`)

| File | Purpose |
|------|---------|
| `thermo-v1.seed.jsonl` | 6 benchmark cases across temporal, decision, trust, cost |
| `run-thermo-eval.mjs` | Scorer: correctness + adaptation + efficiency |
| `LATEST_SNAPSHOT.md` | Current metric summary |

### Documentation (`docs/`)

| Doc | What it covers |
|-----|---------------|
| [Adoption Guide](docs/ADOPTION_GUIDE.md) | Step-by-step integration patterns, config reference, full API |
| [V1 Spec](docs/THERMODYNAMIC_MEMORY_V1_SPEC.md) | Architecture spec, record schema, conflict policy, metrics |
| [Benchmark Mapping](docs/BENCHMARK_MAPPING_THERMODYNAMIC.md) | LongMemEval / Evo-Memory compatibility |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Event → I0 Gate → I1 Extract → I2 Resolve → I3 Route  │
│                        ↓                                │
│  ┌────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐   │
│  │  Past  │ │ Present │ │ Culture │ │ Future Seed  │   │
│  └────────┘ └─────────┘ └─────────┘ └──────────────┘   │
│                        ↓                                │
│  Query → R0 → escalate R1/R2/R3 if needed               │
│                        ↓                                │
│  Weight → Rank → Respond → Feedback → Stage Evolve      │
└─────────────────────────────────────────────────────────┘
```

**Key design principles:**
1. Every query defaults to cheapest retrieval (R0). Escalation is uncertainty- and stakes-driven.
2. Memories carry temporal validity windows and explicit supersession chains.
3. The system self-evolves through 4 developmental stages based on usage metrics.
4. Cost and latency are first-class constraints, not afterthoughts.

---

## Evaluation

```bash
npm run eval:oracle    # oracle upper-bound (sanity ceiling)
npm run eval:real      # scored example run

# Custom predictions
node scripts/run-thermo-eval.mjs --predictions <file> --label <name>
```

Every run is scored across 3 axes: **Correctness**, **Adaptation**, **Efficiency**.

See `eval/LATEST_SNAPSHOT.md` for current results.

---

## External Compatibility

Metric mapping aligns to:
- **LongMemEval** — temporal/conflict reporting
- **Evo-Memory** — streaming/adaptation reporting

See [Benchmark Mapping](docs/BENCHMARK_MAPPING_THERMODYNAMIC.md).

---

## Notes on Scope

This repo focuses on architecture, implementation, and reproducible evaluation artifacts. It intentionally excludes personal conversations, user-specific memory, or private operational logs.

## License

MIT
