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
  useJoltEncoding: true, // jolt-based encoding (prediction error threshold)
});

// ── 2. Remember things (jolt encoder decides what's worth storing) ──
wdma.remember({ fact: 'User prefers dark mode', type: 'preference', layer: 'culture', confidence: 0.9 });
wdma.remember({ fact: 'Deploy cadence is weekly on Tuesdays', type: 'event', layer: 'past', confidence: 0.85 });
wdma.remember({ fact: 'Use RothC and DayCent for benchmarks', type: 'decision', confidence: 0.95, priority: 'high' });
wdma.remember({ fact: 'Private user memory should not be shared', type: 'risk_policy', layer: 'culture', priority: 'critical', confidence: 1.0 });

// Causal claim → automatically routed to hypothesis layer (probationary)
wdma.remember({ fact: 'Slow deploys are caused by missing cache invalidation', type: 'event', confidence: 0.6 });

// Temporal update (supersedes an older memory)
wdma.remember({ id: 'mem_cadence_v1', fact: 'Deploy cadence is monthly', type: 'event', layer: 'past', confidence: 0.7 });
wdma.remember({ fact: 'Deploy cadence is weekly on Tuesdays', type: 'temporal_update', layer: 'past', confidence: 0.9, supersedes: ['mem_cadence_v1'] });

console.log(`\n-- Stored ${wdma.store.size} memories`);
console.log(`   Jolt stats:`, wdma.jolt.stats);

// ── 3. Recall memories (with verification + failure mitigations) ────
const result = await wdma.recall('What is the deploy cadence?');
console.log(`\n-- Retrieved ${result.memories.length} memories via tier ${result.tier}`);
for (const m of result.memories) {
  console.log(`  - [${m.layer}] ${m.fact} (confidence: ${m.confidence})`);
}

// High-stakes query escalates retrieval automatically
const highStakes = await wdma.recall({ text: 'Should we share user memory?', stakes: 'high' });
console.log(`\n-- High-stakes query used tier ${highStakes.tier}`);
for (const m of highStakes.memories) {
  console.log(`  - [${m.priority}] ${m.fact}`);
}

// ── 4. Verify a memory's correctness ────────────────────────────────
const memories = wdma.store.toArray();
if (memories.length > 0) {
  const vResult = await wdma.verify(memories[0]);
  console.log(`\n-- Verification for "${memories[0].fact.slice(0, 40)}...":`);
  console.log(`   Correctness: ${vResult.correctness}, Passed: ${vResult.passed}`);
  if (vResult.flags.length > 0) console.log(`   Flags: ${vResult.flags.join(', ')}`);
}

// ── 5. Compute promotion utility ────────────────────────────────────
if (memories.length > 0) {
  const promo = wdma.computePromotion(memories[0], {
    relevance: 0.8, novelty: 0.6, correctness: 0.9, taskValue: 0.7, accessCost: 0.1,
  });
  console.log(`\n-- Promotion utility for "${memories[0].fact.slice(0, 40)}...":`);
  console.log(`   U(m) = ${promo.utility} → target layer: ${promo.targetLayer}`);
  console.log(`   Promote: ${promo.promote}, Demote: ${promo.demote}`);
}

// ── 6. Generate D0-D5 benchmark ─────────────────────────────────────
const bench = wdma.generateBenchmark({ casesPerLevel: 2 });
console.log(`\n-- Generated D0-D5 benchmark: ${bench.metadata.totalCases} cases`);
for (const [level, count] of Object.entries(bench.metadata.byLevel)) {
  console.log(`   ${level}: ${count} cases`);
}

// ── 7. Provide feedback ─────────────────────────────────────────────
wdma.feedback(true, 1.0);
wdma.feedback(true, 0.9);

// ── 8. Check system health ──────────────────────────────────────────
const health = wdma.health();
console.log('\n-- System health:');
console.log(`   Stage: ${health.stage}`);
console.log(`   Memories: ${health.memoryCount}`);
console.log(`   Mitigation stats:`, health.mitigationStats);

// ── 9. Persist to disk ──────────────────────────────────────────────
wdma.save();
console.log('\n-- Memory persisted to disk');
console.log('\nDone! See examples/agent-integration.js for a full agent loop example.');
