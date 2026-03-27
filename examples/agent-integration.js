#!/usr/bin/env node
/**
 * WDMA Agent Integration Example
 *
 * Shows how to wire WDMA into an agent's observe-think-act loop.
 * This simulates an agent processing a sequence of tasks with memory.
 *
 * Run: node examples/agent-integration.js
 */
import { createWDMA, STAGES } from '../src/index.js';

// ── Create WDMA with custom config ──────────────────────────────────
const wdma = createWDMA({
  persistPath: null,  // in-memory for this demo
  maxRecords: 5000,

  // Tune weights: prioritize relevance and reliability
  weights: { alpha: 0.20, beta: 0.40, gamma: 0.25, delta: 0.15 },

  // Lower thresholds for faster stage progression in demo
  stageThresholds: {
    reactiveToReflective: { minMemories: 10, minQueries: 5 },
    reflectiveToAdaptive: { minPatterns: 2, minReuseRate: 0.05 },
    adaptiveToAutonomous: { minAdaptationSlope: 0.02, minUtilityPerDollar: 50 },
  },

  // Get notified when the system evolves
  onStageChange: (from, to, metrics) => {
    console.log(`\n  ⬆ Stage promotion: ${from} → ${to}`);
    console.log(`    (queries: ${metrics.totalQueries}, memories: ${metrics.totalIngested})`);
  },
});

// ── Simulate Agent Loop ─────────────────────────────────────────────

/**
 * Simulated agent that processes user requests with WDMA memory.
 */
class SimpleAgent {
  constructor(wdma) {
    this.wdma = wdma;
    this.turnCount = 0;
  }

  /** Process one turn of the agent loop */
  async processTurn(userMessage) {
    this.turnCount++;
    console.log(`\n── Turn ${this.turnCount}: "${userMessage}" ──`);

    // OBSERVE: Ingest the user message as a memory event
    this.wdma.remember({
      fact: userMessage,
      type: 'event',
      layer: 'present',
      confidence: 0.8,
      tags: ['user_input'],
      source: { turn: this.turnCount },
    });

    // THINK: Recall relevant context
    const context = await this.wdma.recall({
      text: userMessage,
      stakes: this._assessStakes(userMessage),
    });

    console.log(`  Retrieved ${context.memories.length} memories (tier ${context.tier})`);
    if (context.metadata?.uncertainty > 0) {
      console.log(`  ⚠ Uncertainty: ${(context.metadata.uncertainty * 100).toFixed(0)}%`);
    }

    // ACT: Generate response (simplified - real agent would call LLM here)
    const response = this._generateResponse(userMessage, context);
    console.log(`  Response: "${response}"`);

    // LEARN: Store the decision/response as a memory
    this.wdma.remember({
      fact: `Agent responded to "${userMessage.slice(0, 50)}" with: "${response.slice(0, 80)}"`,
      type: 'decision',
      layer: 'past',
      confidence: 0.7,
      tags: ['agent_response'],
    });

    // Feedback (simulated)
    const correct = Math.random() > 0.2; // 80% correct rate
    this.wdma.feedback(correct, correct ? 0.85 : 0.3);

    return response;
  }

  _assessStakes(message) {
    const highStakesKeywords = ['delete', 'deploy', 'production', 'security', 'private', 'critical'];
    const lower = message.toLowerCase();
    if (highStakesKeywords.some(k => lower.includes(k))) return 'high';
    return 'low';
  }

  _generateResponse(message, context) {
    if (context.memories.length > 0) {
      return `Based on ${context.memories.length} memories: ${context.memories[0].fact}`;
    }
    return `I don't have specific context for that yet.`;
  }
}

// ── Run the simulation ──────────────────────────────────────────────

const agent = new SimpleAgent(wdma);

const conversations = [
  'Set my deploy cadence to weekly',
  'What benchmarks should we use for soil carbon?',
  'Use RothC and DayCent for side-by-side comparison',
  'Remember: never share private user data in logs',
  'What is the rollout sequence?',
  'Use: backtest -> shadow -> pilot -> guarded production',
  'Should we deploy to production today?',
  'What did we decide about benchmarks?',
  'Update cadence to bi-weekly starting next month',
  'The security audit is scheduled for Friday',
  'Can you recall all our deployment decisions?',
  'What is our risk policy for private data?',
  'Schedule the model training for next sprint',
  'Review the benchmark results from last week',
  'Should we share user preferences across teams?',
];

console.log('═══ WDMA Agent Integration Demo ═══');
console.log(`Starting stage: ${wdma.stages.stage}`);

for (const msg of conversations) {
  await agent.processTurn(msg);
}

// Try consolidation if stage allows it
const consolidation = wdma.consolidate();
if (consolidation.ok) {
  console.log(`\n✓ Consolidated ${consolidation.consolidated} memory groups`);
} else {
  console.log(`\n○ ${consolidation.reason}`);
}

// Final health check
const health = wdma.health();
console.log('\n═══ Final System State ═══');
console.log(`  Stage: ${health.stage}`);
console.log(`  Memories: ${health.memoryCount}`);
console.log(`  Stage metrics:`, JSON.stringify(health.stageMetrics, null, 2));
console.log(`  Capabilities:`, health.stageCapabilities);
