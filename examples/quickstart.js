#!/usr/bin/env node
/**
 * WDMA Quickstart Example
 *
 * Demonstrates the minimum code needed to add WDMA memory to an agent.
 * Run: node examples/quickstart.js
 */
import { createWDMA } from '../src/index.js';

// ── 1. Create the memory system (one line) ──────────────────────────
const wdma = createWDMA({
  persistPath: './data/quickstart-memory.json', // set to null for in-memory only
});

// ── 2. Remember things ──────────────────────────────────────────────
wdma.remember({ fact: 'User prefers dark mode', type: 'preference', layer: 'culture', confidence: 0.9 });
wdma.remember({ fact: 'Deploy cadence is weekly on Tuesdays', type: 'event', layer: 'past', confidence: 0.85 });
wdma.remember({ fact: 'Use RothC and DayCent for benchmarks', type: 'decision', confidence: 0.95, priority: 'high' });
wdma.remember({ fact: 'Private user memory should not be shared', type: 'risk_policy', layer: 'culture', priority: 'critical', confidence: 1.0 });

// Temporal update (supersedes an older memory)
const old = wdma.remember({ id: 'mem_cadence_v1', fact: 'Deploy cadence is monthly', type: 'event', layer: 'past', confidence: 0.7 });
wdma.remember({ fact: 'Deploy cadence is weekly on Tuesdays', type: 'temporal_update', layer: 'past', confidence: 0.9, supersedes: ['mem_cadence_v1'] });

console.log(`\n✓ Stored ${wdma.store.size} memories`);

// ── 3. Recall memories ──────────────────────────────────────────────
const result = await wdma.recall('What is the deploy cadence?');
console.log(`\n✓ Retrieved ${result.memories.length} memories via tier ${result.tier}`);
for (const m of result.memories) {
  console.log(`  - [${m.layer}] ${m.fact} (confidence: ${m.confidence})`);
}

// High-stakes query escalates retrieval automatically
const highStakes = await wdma.recall({ text: 'Should we share user memory?', stakes: 'high' });
console.log(`\n✓ High-stakes query used tier ${highStakes.tier}`);
for (const m of highStakes.memories) {
  console.log(`  - [${m.priority}] ${m.fact}`);
}

// ── 4. Provide feedback ─────────────────────────────────────────────
wdma.feedback(true, 1.0); // correct answer
wdma.feedback(true, 0.9);

// ── 5. Check system health ──────────────────────────────────────────
const health = wdma.health();
console.log('\n✓ System health:');
console.log(`  Stage: ${health.stage}`);
console.log(`  Memories: ${health.memoryCount}`);
console.log(`  Ingest stats:`, health.ingestStats);
console.log(`  Retrieval stats:`, health.retrievalStats);

// ── 6. Persist to disk ──────────────────────────────────────────────
wdma.save();
console.log('\n✓ Memory persisted to disk');
console.log('\nDone! See examples/agent-integration.js for a full agent loop example.');
