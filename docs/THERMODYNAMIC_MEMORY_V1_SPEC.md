# Thermodynamic Memory v1 Spec

## Objective

Build a memory system that maximizes **decision-quality-per-unit-compute** under realistic deployment constraints.

## Design principles

1. Do not optimize only for benchmark recall.
2. Handle temporal updates and contradictions explicitly.
3. Escalate retrieval depth only when confidence or stakes demand it.
4. Keep cost and latency as first-class constraints.

## Normalized memory record

```json
{
  "id": "mem_x",
  "layer": "past|present|culture|future_seed",
  "type": "identity|preference|decision|task|event|temporal_update|constraint|risk_policy",
  "fact": "canonical statement",
  "time": {
    "valid_from": "ISO-8601",
    "valid_to": null,
    "event_time": null
  },
  "supersedes": ["mem_old"],
  "confidence": 0.0,
  "priority": "low|medium|high|critical",
  "tags": [],
  "source": {
    "session_id": "...",
    "message_ref": "...",
    "timestamp": "ISO-8601"
  }
}
```

## Ingest pipeline

- I0: cheap event gate
- I1: structured extractor
- I2: contradiction/time resolver
- I3: layer router + batch writer

### Ingest guardrails

- batch writes (count/time)
- dedupe via semantic hash
- skip low-confidence low-priority noise

## Retrieval ladder

- **R0**: default low-cost retrieval
- **R1**: add timeline resolver
- **R2**: add context/trust resolver
- **R3**: full multi-agent retrieval

### Escalation triggers

Escalate when any true:

- confidence below threshold
- contradiction probability above threshold
- stakes high
- action irreversibility high

### Hard caps

- model calls per tier (example): R0=1, R1=2, R2=2, R3=4
- token budget per query
- timeout budget per query

## Conflict policy

1. Prefer latest valid fact if supersession chain exists.
2. If unresolved conflict, surface uncertainty.
3. Never fabricate resolution.
4. Preserve audit trail of prior states.

## Metrics

### Correctness

- Accuracy@1
- Temporal consistency
- Contradiction resolution rate
- Hallucinated memory rate

### Adaptation

- experience reuse gain
- sequence adaptation slope
- sequence robustness variance

### Thermodynamic efficiency

- mean/p95 latency
- tokens/query
- $/query
- utility-per-dollar
- retrieval tier mix
