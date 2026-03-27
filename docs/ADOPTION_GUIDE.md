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

## Jolt-Based Encoding

Instead of saving everything, WDMA uses **prediction error** ("jolt") to decide whether a memory is worth encoding. The threshold rises with domain experience — the system becomes harder to surprise as it learns.

```
Jolt(e) = |observed(e) - predicted(e)|
θ(d) = θ_base + θ_growth · log(1 + experience(d))
encode(e) = Jolt(e) > θ(domain(e))
```

The jolt is a composite of three signals:
- **Novelty** (35%): how different is this from existing memories?
- **Contradiction** (40%): does this conflict with established facts?
- **Information gain** (25%): how much new content does this add?

Override with a custom prediction function for embedding-based jolt:

```js
const wdma = createWDMA({
  joltPredictFn: (event, domainHistory) => {
    // Your embedding similarity check here
    return { predicted: 'expected text', confidence: 0.8 };
  },
});
```

---

## Promotion Utility Function

Memories are promoted/demoted across a 6-layer typed graph based on the formalized utility:

```
U(m) = α·R(m) + β·N(m) + γ·C(m) + δ·V(m) - λ·A(m)
```

Subject to constraints:
- `ErrorRate(m) ≤ ε_max`
- `Cost(m) ≤ budget`
- `Staleness(m) ≤ τ_max`

| Signal | Weight | Meaning |
|--------|--------|---------|
| R(m) | α = 0.20 | Recency/relevance |
| N(m) | β = 0.20 | Novelty (from jolt encoder) |
| C(m) | γ = 0.25 | Correctness (from verification gate) |
| V(m) | δ = 0.20 | Downstream task value |
| A(m) | λ = 0.15 | Access cost (penalty) |

### Promotion Layers (L0–L5)

The layers are a **typed memory graph** (not a vertical stack):

| Layer | Threshold | Type | Decay Rate |
|-------|-----------|------|------------|
| **L0_buffer** | 0.00 | Temporary intake | Fast (1.0) |
| **L1_working** | 0.15 | Active working memory | Moderate (0.5) |
| **L2_episodic** | 0.30 | Factual episodic memory | Slow (0.1) |
| **L3_hypothesis** | 0.45 | Hypothetical/simulation branch | Moderate (0.2) |
| **L4_procedural** | 0.60 | Policy/meta-response behavior | Very slow (0.02) |
| **L5_cultural** | 0.75 | Deployment priors, identity | Near-permanent (0.005) |

```js
const promo = wdma.computePromotion(memory, {
  relevance: 0.8, novelty: 0.6, correctness: 0.9, taskValue: 0.7, accessCost: 0.1,
});
// { utility: 0.63, targetLayer: 'L4_procedural', promote: true }
```

---

## Verification Gate

The correctness term `C(m)` is scored by three structural checks:

| Check | Weight | What it validates |
|-------|--------|-------------------|
| **Temporal consistency** | 35% | Timeline makes sense, valid_from < valid_to, supersession order |
| **Source attribution** | 25% | Source metadata exists, session/message refs, trusted origin |
| **Contradiction handling** | 40% | No unresolved conflicts with verified memories |

```js
const vResult = await wdma.verify(memory);
// { correctness: 0.85, passed: true, checks: { temporal, source, contradiction }, flags: [] }
```

Supply a custom LLM-backed verifier for deeper fact-checking:

```js
const wdma = createWDMA({
  customVerifier: async (memory, existingMemories) => {
    const result = await callLLM(`Is this fact correct? ${memory.fact}`);
    return result.confidence;  // 0-1
  },
});
```

---

## D0–D5 Benchmark Taxonomy

Generate benchmark cases at 6 difficulty levels from your memory store:

| Level | Name | Tests |
|-------|------|-------|
| **D0** | Raw Recall | Direct fact retrieval |
| **D1** | Temporal Ordering | "Which came first/last?" |
| **D2** | One-Knob Perturbation | Near-miss confabulation (number swap, entity swap, negation) |
| **D3** | Contradiction Detection | Conflicting facts, supersession resolution |
| **D4** | Abstraction | Pattern extraction from episodic memories |
| **D5** | Calibration | "I don't know" detection, false-certainty |

```js
const bench = wdma.generateBenchmark({ casesPerLevel: 10 });
// { cases: [...], metadata: { totalCases: 60, byLevel: { D0: 10, D1: 10, ... } } }

// Export as JSONL for the eval runner
const jsonl = wdma.benchmark.toJsonl(bench.cases);
```

---

## Failure-Mode Mitigations

Three architectural safeguards against known failure modes:

### 1. Self-Confirmation Loop Prevention

Memories that **challenge the consensus** get a weight bonus, preventing echo chambers:

```js
// Automatic during recall — disconfirming memories get boosted
// Configure the bonus strength:
createWDMA({ disconfirmationBonus: 0.15 });
```

### 2. Stale-Memory Contamination Prevention

Progressive decay penalizes old memories that haven't been reconfirmed:

```
penalty = min(maxPenalty, 1 - 0.5^(age / halfLife))
```

Critical/high-priority memories decay slower (priority shield).

### 3. Probationary Routing for Causal Claims

Memories containing causal language ("because", "caused by", "leads to") are automatically routed to the **hypothesis layer (L3)** with capped confidence. They must accumulate enough confirmations from downstream task outcomes before promotion:

```js
wdma.feedback(true, 0.9, memoryId);  // confirm a causal claim
// After enough confirmations, it gets promoted out of probation
```

---

## Weighting Formula

Each memory gets a composite weight:

```
W(m) = α·recency + β·relevance + γ·reliability + δ·reinforcement
```

Then adjusted by a cost multiplier and failure mitigations:

```
final_weight = W(m) × tierCostMultiplier[tier] × (1 - staleness) + disconfirmationBonus
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

  // Jolt encoding
  useJoltEncoding: true,              // enable prediction-error gating
  joltBaseThreshold: 0.2,             // starting threshold
  joltGrowthRate: 0.08,               // threshold growth per domain experience
  joltMaxThreshold: 0.85,             // ceiling
  joltPredictFn: null,                // custom (event, history) => { confidence }

  // Ingest
  gateThreshold: 0.15,               // confidence floor for I0 gate
  batchSize: 10,                      // batch buffer size
  batchIntervalMs: 5000,             // batch flush interval

  // Retrieval
  confidenceFloor: 0.6,              // escalate if below this
  contradictionCeiling: 0.3,         // escalate if above this
  maxTier: 'R3',                     // highest allowed tier

  // Promotion utility (U(m) = αR + βN + γC + δV - λA)
  promotionAlpha: 0.20,              // relevance weight
  promotionBeta: 0.20,               // novelty weight
  promotionGamma: 0.25,              // correctness weight
  promotionDelta: 0.20,              // task value weight
  promotionLambda: 0.15,             // cost penalty weight
  maxErrorRate: 0.1,                 // constraint: max error rate
  maxBudgetUsd: 0.01,                // constraint: per-query budget
  maxStalenessMs: 2592000000,        // constraint: 30-day max staleness

  // Verification gate
  verificationPassThreshold: 0.3,    // minimum correctness to pass
  customVerifier: null,               // async (memory, existing) => score
  trustedSources: [],                 // known trusted source IDs

  // Failure mitigations
  disconfirmationBonus: 0.15,         // bonus for consensus-challenging memories
  stalenessHalfLifeMs: 1209600000,   // 14 days
  probationConfidenceCap: 0.6,        // confidence cap for causal claims

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
# Run oracle (upper bound) benchmark
npm run eval:oracle

# Run with your predictions
node scripts/run-thermo-eval.mjs --predictions eval/thermo-v1.predictions.template.jsonl --label my-run
```

Generate D0-D5 benchmark cases programmatically:

```js
const bench = wdma.generateBenchmark({ casesPerLevel: 10, levels: ['D0','D1','D2','D3','D4','D5'] });
fs.writeFileSync('eval/d0-d5-cases.jsonl', wdma.benchmark.toJsonl(bench.cases));
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
│   ├── developmental-stages.js   # Self-evolution stage manager
│   ├── jolt-encoder.js           # Prediction-error encoding gate
│   ├── promotion-utility.js      # U(m) formalized objective + L0-L5 routing
│   ├── verification-gate.js      # Correctness scoring (temporal/source/contradiction)
│   ├── d0-d5-benchmark.js        # Synthetic benchmark generator
│   └── failure-mitigations.js    # Disconfirmation, staleness, probation
├── examples/
│   ├── quickstart.js             # Minimal working example
│   └── agent-integration.js      # Full agent loop example
├── eval/                         # Benchmark evaluation
├── docs/                         # Architecture specs
├── wdma.config.example.json      # Example configuration
└── package.json
```
