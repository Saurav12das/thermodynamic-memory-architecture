# Thermodynamic Memory Architecture

A public, implementation-oriented blueprint for **cost-aware, self-evolving memory systems** for LLM agents.

## Core idea

Most memory systems optimize for recall quality only.
This architecture optimizes for:

- **Correctness** (especially temporal + conflict-heavy recall)
- **Adaptation** (experience reuse over streams)
- **Efficiency** (latency, tokens, and dollars)

In short: **maximize decision quality per unit compute**.

---

## Architecture overview

### Strategic layers

- **Past Layer**: durable facts and long-lived anchors
- **Present Layer**: current priorities and active context
- **Future/PESL Layer**: branch simulation before commitment
- **RECL Layer**: commit / hedge / probe / defer policy
- **Culture/Context Layer**: trust and human-adoption constraints

### Execution spine

1. **Automated ingest pipeline**
   - Event gate (cheap)
   - Structured extraction
   - Contradiction/time resolution
   - Layer routing + batch writes

2. **Progressive retrieval ladder**
   - R0: cheapest default retrieval
   - R1: temporal resolver
   - R2: context/trust resolver
   - R3: full multi-agent retrieval for high-stakes conflict

3. **Cost-policy governor**
   - hard caps on calls/tokens/time
   - escalation only under uncertainty/stakes

4. **Benchmark/eval harness**
   - internal thermodynamic scorecard
   - mapping to external benchmark conventions

---

## Repository structure

- `docs/THERMODYNAMIC_MEMORY_V1_SPEC.md` — architecture spec
- `docs/BENCHMARK_MAPPING_THERMODYNAMIC.md` — internal ↔ external metric mapping
- `eval/thermo-v1.seed.jsonl` — seed benchmark set
- `eval/THERMODYNAMIC_MEMORY_KPI_TEMPLATE.md` — weekly KPI template

---

## Evaluation philosophy

Never report memory accuracy alone.
Always report:

- accuracy (overall + temporal/conflict)
- p50/p95 latency
- tokens/query
- $/query
- adaptation signals (reuse gain, sequence robustness)

---

## License

MIT
