# Benchmark Mapping: Internal Thermodynamic KPIs ↔ External Conventions

## Purpose

Translate internal metrics into externally recognizable benchmark language while preserving cost-awareness.

## Internal source metrics

- Accuracy@1 (overall + by track)
- Hallucinated memory rate
- p50/p95 latency
- mean tokens/query
- mean $/query
- utility-per-dollar
- tier mix

## LongMemEval-style mapping

- Temporal Accuracy@1 ← internal temporal track
- Conflict Resolution Rate ← temporal conflict subset
- Source-Faithful Rate ← citation/trace validation
- Context-length robustness ← accuracy by context bucket

## Evo-Memory-style mapping

- Streaming accuracy curve ← accuracy by task index/segment
- Experience Reuse Gain ← recurring-pattern improvement
- Sequence Robustness Delta ← score variance across order permutations
- Step efficiency/success/progress (for interactive tasks)

## Public reporting standard

Always include:

1. Correctness
2. Adaptation
3. Cost + latency

No headline score without efficiency sidecar.
