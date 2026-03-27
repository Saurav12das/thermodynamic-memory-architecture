# WDMA Adoption Guide

One-click instructions for adding Weighted Developmental Memory Architecture to your agent.

---

## Quick Start (3 lines)

```js
import { createWDMA } from './src/index.js';
const wdma = createWDMA({ persistPath: './data/memory.json' });

// In your agent loop:
wdma.remember({ fact: 'user said X', type: 'event' });          // ingest
const result = await wdma.recall('what did user say?');           // retrieve
wdma.feedback(true);                                              // learn
```

That's it. The system handles gating, extraction, conflict resolution, layer routing, tiered retrieval, weighting, and developmental stage progression automatically.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        WDMA System                              │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   INGEST PIPELINE                        │   │
│  │  Event → I0 Gate → I1 Extract → I2 Resolve → I3 Route   │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │                   MEMORY STORE                           │   │
│  │  ┌────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐    │   │
│  │  │  Past  │ │ Present │ │ Culture │ │ Future Seed  │    │   │
│  │  └────────┘ └─────────┘ └─────────┘ └──────────────┘    │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │                 RETRIEVAL LADDER                          │   │
│  │  Query → R0 Cheap → R1 Timeline → R2 Trust → R3 Multi   │   │
│  │              ↑ escalate only if needed ↑                  │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                       │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │              WEIGHT CALCULATOR                            │   │
│  │  W(m) = α·recency + β·relevance + γ·reliability          │   │
│  │         + δ·reinforcement × costMultiplier                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │           DEVELOPMENTAL STAGES                            │   │
│  │  REACTIVE → REFLECTIVE → ADAPTIVE → AUTONOMOUS           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Patterns

### Pattern 1: Observe-Think-Act Loop

The most common pattern. Your agent remembers observations, recalls context before acting, and stores decisions.

```js
import { createWDMA } from './src/index.js';

const wdma = createWDMA({ persistPath: './data/memory.json' });

async function agentLoop(input) {
  // OBSERVE: Store the input
  wdma.remember({
    fact: input,
    type: 'event',
    confidence: 0.8,
    tags: ['user_input'],
  });

  // THINK: Recall relevant context
  const context = await wdma.recall({
    text: input,
    stakes: assessStakes(input),  // 'low' | 'high' | 'critical'
  });

  // ACT: Use memories in your LLM prompt
  const memories = context.memories.map(m => m.fact).join('\n');
  const response = await callLLM(`Context:\n${memories}\n\nUser: ${input}`);

  // LEARN: Store the decision
  wdma.remember({
    fact: `Decided: ${response.slice(0, 200)}`,
    type: 'decision',
    layer: 'past',
    confidence: 0.7,
  });

  // FEEDBACK: Record if the response was useful
  // (call this later when you know the outcome)
  // wdma.feedback(correct, score);

  return response;
}
```

### Pattern 2: Event Stream Processing

For agents that process a continuous stream of events (logs, webhooks, sensor data).

```js
const wdma = createWDMA({
  gateThreshold: 0.2,    // filter out noise
  batchSize: 20,          // batch writes
  batchIntervalMs: 3000,  // flush every 3s
});

// Add events to the batch buffer
eventStream.on('event', (evt) => {
  wdma.ingest.addToBatch({
    fact: evt.message,
    type: evt.type,
    confidence: evt.confidence || 0.5,
    priority: evt.severity === 'critical' ? 'critical' : 'medium',
    tags: evt.tags,
  });
});

// Periodically consolidate
setInterval(() => {
  const result = wdma.consolidate();
  if (result.ok) console.log(`Consolidated ${result.consolidated} groups`);
}, 60000);
```

### Pattern 3: Multi-Agent Shared Memory

Multiple agents share the same memory store but use different retrieval tiers.

```js
import { MemoryStore, IngestPipeline, RetrievalLadder, WeightCalculator } from './src/index.js';

// Shared store
const store = new MemoryStore({ persistPath: './data/shared.json' });
const weights = new WeightCalculator();

// Agent A: fast retrieval (R0 only)
const agentA = new RetrievalLadder(store, { maxTier: 'R0' });

// Agent B: deep retrieval (up to R3)
const agentB = new RetrievalLadder(store, { maxTier: 'R3' });

// Shared ingest
const pipeline = new IngestPipeline(store);
```

### Pattern 4: Custom LLM-Backed Retrieval

Replace default retrieval handlers with your own LLM-powered resolvers.

```js
const wdma = createWDMA({
  // Custom R1: Use an LLM to resolve temporal queries
  r1Handler: async (query, prevResult, caps) => {
    const memories = prevResult?.memories || [];
    const prompt = `Given these memories:\n${memories.map(m => m.fact).join('\n')}\n\nResolve the timeline for: ${query.text}`;
    const llmResult = await callLLM(prompt, { maxTokens: caps.maxTokens });

    return {
      memories: memories,  // return filtered/reranked
      confidence: llmResult.confidence,
      cost: { tokens: llmResult.tokensUsed, calls: 1 },
      metadata: { source: 'llm_timeline_resolver' },
    };
  },

  // Custom R3: Fan out to specialist agents
  r3Handler: async (query, prevResult, caps) => {
    const [factAgent, temporalAgent, trustAgent] = await Promise.all([
      callFactAgent(query.text),
      callTemporalAgent(query.text),
      callTrustAgent(query.text),
    ]);
    // Merge and rank results...
    return { memories: merged, confidence: 0.95, cost: { calls: 3, tokens: 2000 }, metadata: {} };
  },
});
```

---

## Memory Record Schema

Every memory follows this normalized structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (auto-generated if not provided) |
| `layer` | `past\|present\|culture\|future_seed` | Memory layer |
| `type` | string | `identity\|preference\|decision\|task\|event\|temporal_update\|constraint\|risk_policy` |
| `fact` | string | The canonical statement |
| `time.valid_from` | ISO-8601 | When the fact became valid |
| `time.valid_to` | ISO-8601\|null | When the fact stopped being valid |
| `time.event_time` | ISO-8601\|null | When the original event occurred |
| `supersedes` | string[] | IDs of records this one replaces |
| `confidence` | number (0-1) | How confident we are in this fact |
| `priority` | `low\|medium\|high\|critical` | Importance level |
| `tags` | string[] | Searchable tags |
| `source` | object | Provenance metadata |

---

## Memory Layers

| Layer | Purpose | Examples |
|-------|---------|----------|
| **past** | Historical events and decisions | "Deployed v2.3 on March 1st" |
| **present** | Current state and active tasks | "Working on feature X" |
| **culture** | Persistent rules, preferences, identity | "Always use dark mode", "Never share PII" |
| **future_seed** | Planned/anticipated events | "Security audit scheduled for Friday" |

---

## Retrieval Tiers

| Tier | Cost | Behavior | When Used |
|------|------|----------|-----------|
| **R0** | Low | Keyword/embedding search | Default for all queries |
| **R1** | Medium | + Timeline resolution (supersession chains) | Temporal queries, low confidence at R0 |
| **R2** | Higher | + Context/trust filtering | High-stakes queries, contradictions |
| **R3** | Highest | + Multi-agent retrieval | Critical/irreversible decisions |

Escalation is automatic based on: confidence, contradiction probability, stakes, and irreversibility.

---

## Developmental Stages

The system self-evolves through 4 stages:

| Stage | Capabilities | Promotion Criteria |
|-------|-------------|-------------------|
| **REACTIVE** | Store + Retrieve (R0 only) | 50 memories + 20 queries |
| **REFLECTIVE** | + Consolidation + Pattern detection (R0-R1) | 5 patterns + 10% reuse rate |
| **ADAPTIVE** | + Experience reuse + Weight adjustment (R0-R2) | Positive adaptation slope + utility/$ > 100 |
| **AUTONOMOUS** | + Self-tuning + Proactive management (R0-R3) | — |

Check current capabilities:

```js
const caps = wdma.stages.getCapabilities();
// { canStore: true, canRetrieve: true, canConsolidate: false, ... maxRetrievalTier: 'R0' }
```

---

## Weighting Formula

Each memory gets a composite weight:

```
W(m) = α·recency + β·relevance + γ·reliability + δ·reinforcement
```

Then adjusted by a cost multiplier based on the retrieval tier:

```
final_weight = W(m) × tierCostMultiplier[tier]
```

Default coefficients (α + β + γ + δ = 1.0):

| Coefficient | Default | Signal |
|------------|---------|--------|
| α (alpha) | 0.25 | Recency — exponential decay with configurable half-life |
| β (beta) | 0.35 | Relevance — keyword overlap (override with embeddings) |
| γ (gamma) | 0.25 | Reliability — confidence + priority |
| δ (delta) | 0.15 | Reinforcement — access frequency (log-scaled) |

---

## Configuration Reference

All config options for `createWDMA()`:

```js
createWDMA({
  // Storage
  persistPath: './data/memory.json',  // null for in-memory only
  maxRecords: 10000,                  // evicts lowest-priority when exceeded

  // Weighting
  weights: { alpha: 0.25, beta: 0.35, gamma: 0.25, delta: 0.15 },
  decayHalfLifeMs: 604800000,        // 7 days

  // Ingest
  gateThreshold: 0.15,               // confidence floor for I0 gate
  batchSize: 10,                      // batch buffer size
  batchIntervalMs: 5000,             // batch flush interval

  // Retrieval
  confidenceFloor: 0.6,              // escalate if below this
  contradictionCeiling: 0.3,         // escalate if above this
  maxTier: 'R3',                     // highest allowed tier

  // Developmental stages
  initialStage: 'reactive',
  stageThresholds: { ... },

  // Custom handlers
  extractor: (event) => record,       // custom I1 extractor
  layerRouter: (record) => record,    // custom I3 router
  r0Handler: async (q, prev, caps) => result,
  r1Handler: async (q, prev, caps) => result,
  r2Handler: async (q, prev, caps) => result,
  r3Handler: async (q, prev, caps) => result,

  // Callbacks
  onStageChange: (from, to, metrics) => {},
  onDrop: ({ stage, reason, event }) => {},
});
```

---

## Running the Evaluation

Test your memory system against the built-in benchmark:

```bash
# Generate a predictions template
node scripts/run-thermo-eval.mjs

# Run oracle (upper bound) benchmark
npm run eval:oracle

# Run with your predictions
node scripts/run-thermo-eval.mjs --predictions eval/thermo-v1.predictions.template.jsonl --label my-run
```

Metrics are scored across 3 axes: **Correctness**, **Adaptation**, and **Efficiency**.

---

## File Structure

```
thermodynamic-memory-architecture/
├── src/
│   ├── index.js                  # Main entry point + createWDMA()
│   ├── memory-store.js           # Memory storage with indexing
│   ├── ingest-pipeline.js        # I0-I3 ingest pipeline
│   ├── retrieval-ladder.js       # R0-R3 tiered retrieval
│   ├── weight-calculator.js      # Composite weighting formula
│   ├── conflict-resolver.js      # Contradiction resolution + audit
│   └── developmental-stages.js   # Self-evolution stage manager
├── examples/
│   ├── quickstart.js             # Minimal working example
│   └── agent-integration.js      # Full agent loop example
├── eval/                         # Benchmark evaluation
├── docs/                         # Architecture specs
├── wdma.config.example.json      # Example configuration
└── package.json
```
