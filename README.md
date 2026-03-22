# Thermodynamic Memory Architecture

A runnable reference implementation + evaluation harness for **cost-aware, self-evolving memory systems**.

## Why this exists

Most memory projects report a single recall number and ignore deployment economics.
This project treats memory as an optimization problem:

> **Maximize decision quality per unit compute**

That means every run is judged across 3 axes:
1. **Correctness** (including temporal/conflict-heavy recall)
2. **Adaptation** (experience reuse over time)
3. **Efficiency** (latency, token, and dollar budgets)

---

## What is implemented

This repo includes executable code (not docs-only):

- `scripts/run-thermo-eval.mjs` — benchmark runner
- `eval/thermo-v1.seed.jsonl` — seed benchmark cases
- `eval/thermo-v1.predictions.example.jsonl` — example predictions file
- `eval/results/*.json` — generated result artifacts
- `eval/LATEST_SNAPSHOT.md` — latest metric summary
- `docs/*.md` — architecture and benchmark mapping specs

---

## Quickstart

```bash
npm run eval:oracle
npm run eval:real
```

### Custom predictions

```bash
node scripts/run-thermo-eval.mjs --predictions eval/thermo-v1.predictions.template.jsonl --label my-run
```

If no predictions file is provided, the runner auto-generates:

- `eval/thermo-v1.predictions.template.jsonl`

---

## Architecture (high-level)

```text
Incoming Events
  -> Ingest Gate (cheap)
  -> Structured Extractor
  -> Contradiction/Temporal Resolver (supersedes chains)
  -> Layer Router (Past / Present / Future-PESL / RECL / Culture)

Question
  -> R0 cheap retrieval
  -> escalate to R1/R2/R3 only if needed
  -> answer + calibrated confidence
  -> score against correctness + adaptation + cost metrics
```

Escalation policy is uncertainty- and stakes-aware; low-risk queries stay cheap.

---

## Current benchmark snapshot

See: `eval/LATEST_SNAPSHOT.md`

This repository ships with:
- oracle upper-bound run (sanity ceiling)
- first example scored run (non-oracle)

---

## External compatibility

The metric mapping doc aligns internal scorecards to:
- LongMemEval-style temporal/conflict reporting
- Evo-Memory-style streaming/adaptation reporting

See `docs/BENCHMARK_MAPPING_THERMODYNAMIC.md`.

---

## Notes on scope

This public repo intentionally excludes any personal conversations, user-specific memory, or private operational logs.
It focuses only on architecture, evaluation logic, and reproducible technical artifacts.

## License

MIT
