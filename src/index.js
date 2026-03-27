/**
 * WDMA - Weighted Developmental Memory Architecture
 *
 * One-click memory system for LLM agents.
 * Import { createWDMA } and call it with your config to get a fully wired system.
 */
import { MemoryStore } from './memory-store.js';
import { IngestPipeline } from './ingest-pipeline.js';
import { RetrievalLadder } from './retrieval-ladder.js';
import { WeightCalculator } from './weight-calculator.js';
import { ConflictResolver } from './conflict-resolver.js';
import { DevelopmentalStageManager, STAGES } from './developmental-stages.js';

export { MemoryStore } from './memory-store.js';
export { IngestPipeline } from './ingest-pipeline.js';
export { RetrievalLadder } from './retrieval-ladder.js';
export { WeightCalculator } from './weight-calculator.js';
export { ConflictResolver } from './conflict-resolver.js';
export { DevelopmentalStageManager, STAGES } from './developmental-stages.js';

/**
 * Create a fully wired WDMA memory system with one call.
 *
 * @param {Object} config - Configuration options
 * @param {string} config.persistPath - File path for memory persistence (null for in-memory only)
 * @param {number} config.maxRecords - Maximum memory records before eviction (default: 10000)
 * @param {Object} config.weights - Weight parameters { alpha, beta, gamma, delta }
 * @param {number} config.decayHalfLifeMs - Recency decay half-life in ms (default: 7 days)
 * @param {number} config.gateThreshold - Minimum confidence to pass ingest gate (default: 0.15)
 * @param {number} config.confidenceFloor - Min confidence before retrieval escalation (default: 0.6)
 * @param {string} config.maxTier - Highest retrieval tier allowed (default: 'R3')
 * @param {string} config.initialStage - Starting developmental stage (default: 'reactive')
 * @param {Function} config.extractor - Custom I1 extractor function
 * @param {Function} config.layerRouter - Custom I3 layer router function
 * @param {Function} config.r0Handler - Custom R0 retrieval handler
 * @param {Function} config.r1Handler - Custom R1 retrieval handler
 * @param {Function} config.r2Handler - Custom R2 retrieval handler
 * @param {Function} config.r3Handler - Custom R3 retrieval handler
 * @param {Function} config.onStageChange - Callback when developmental stage changes
 * @param {Function} config.onDrop - Callback when events are dropped at ingest
 *
 * @returns {WDMA} Fully wired memory system
 */
export function createWDMA(config = {}) {
  return new WDMA(config);
}

export class WDMA {
  constructor(config = {}) {
    // Core store
    this.store = new MemoryStore({
      persistPath: config.persistPath || null,
      maxRecords: config.maxRecords,
    });

    // Weight calculator
    this.weights = new WeightCalculator({
      weights: config.weights,
      decayHalfLifeMs: config.decayHalfLifeMs,
      tierCostMultiplier: config.tierCostMultiplier,
    });

    // Conflict resolver
    this.conflicts = new ConflictResolver(this.store, {
      uncertaintyThreshold: config.uncertaintyThreshold,
    });

    // Ingest pipeline
    this.ingest = new IngestPipeline(this.store, {
      gateThreshold: config.gateThreshold,
      batchSize: config.batchSize,
      batchIntervalMs: config.batchIntervalMs,
      extractor: config.extractor,
      layerRouter: config.layerRouter,
      onDrop: config.onDrop,
    });

    // Retrieval ladder
    this.retrieval = new RetrievalLadder(this.store, {
      confidenceFloor: config.confidenceFloor,
      contradictionCeiling: config.contradictionCeiling,
      maxTier: config.maxTier,
      tierCaps: config.tierCaps,
      r0Handler: config.r0Handler,
      r1Handler: config.r1Handler,
      r2Handler: config.r2Handler,
      r3Handler: config.r3Handler,
    });

    // Developmental stage manager
    this.stages = new DevelopmentalStageManager(this.store, this.weights, {
      initialStage: config.initialStage,
      thresholds: config.stageThresholds,
      onStageChange: config.onStageChange,
    });
  }

  // ── Convenience API ─────────────────────────────────────────────

  /**
   * Ingest a memory event (text, fact, or structured record).
   * Runs through the full I0->I1->I2->I3 pipeline.
   */
  remember(event) {
    const record = this.ingest.ingest(event);
    if (record) this.stages.recordIngestion();
    return record;
  }

  /**
   * Ingest multiple events at once.
   */
  rememberAll(events) {
    const records = this.ingest.ingestBatch(events);
    for (const _ of records) this.stages.recordIngestion();
    return records;
  }

  /**
   * Retrieve memories relevant to a query.
   * Automatically escalates retrieval tier based on confidence/stakes.
   *
   * @param {string|Object} query - Query text or { text, stakes?, irreversibility? }
   * @returns {Promise<Object>} RetrievalResult with ranked memories
   */
  async recall(query) {
    const q = typeof query === 'string' ? { text: query } : query;

    // Respect developmental stage tier limits
    const caps = this.stages.getCapabilities();
    const tierOrder = ['R0', 'R1', 'R2', 'R3'];
    const maxTierIdx = tierOrder.indexOf(caps.maxRetrievalTier);
    const effectiveMaxTier = tierOrder[Math.min(
      maxTierIdx,
      tierOrder.indexOf(this.retrieval.maxTier)
    )];

    const originalMax = this.retrieval.maxTier;
    this.retrieval.maxTier = effectiveMaxTier;

    const result = await this.retrieval.retrieve(q);

    this.retrieval.maxTier = originalMax;

    // Resolve conflicts in retrieved memories
    const { resolved, conflicts, uncertainty } = this.conflicts.resolve(result.memories);
    result.memories = resolved;
    result.metadata = result.metadata || {};
    result.metadata.conflicts = conflicts;
    result.metadata.uncertainty = uncertainty;

    // Rank by weight
    const ranked = this.weights.rank(resolved, {
      queryText: q.text,
      tier: result.tier,
    });
    result.memories = ranked.map(r => r.memory);
    result.metadata.weights = ranked.map(r => ({ id: r.memory.id, weight: r.weight, components: r.components }));

    // Record access for reinforcement
    for (const m of result.memories) {
      this.weights.recordAccess(m.id);
      this.stages.recordReuse(m.id);
    }

    this.stages.recordQuery(result.cost?.costUsd || 0);

    return result;
  }

  /**
   * Provide feedback on the last retrieval result.
   */
  feedback(correct, score = null) {
    this.stages.recordFeedback(correct, score);
  }

  /**
   * Run consolidation (episodic -> semantic).
   * Only works if developmental stage supports it (REFLECTIVE+).
   */
  consolidate() {
    return this.stages.consolidate();
  }

  /**
   * Persist memory to disk (if persistPath was configured).
   */
  save() {
    this.store.save();
  }

  /**
   * Get a full system health snapshot.
   */
  health() {
    return {
      memoryCount: this.store.size,
      stage: this.stages.stage,
      stageCapabilities: this.stages.getCapabilities(),
      stageMetrics: this.stages.metrics,
      ingestStats: this.ingest.stats,
      retrievalStats: this.retrieval.stats,
    };
  }
}
