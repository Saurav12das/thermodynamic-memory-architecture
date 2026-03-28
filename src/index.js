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
import { JoltEncoder } from './jolt-encoder.js';
import { PromotionUtility } from './promotion-utility.js';
import { VerificationGate } from './verification-gate.js';
import { D0D5Benchmark } from './d0-d5-benchmark.js';
import { FailureMitigations } from './failure-mitigations.js';
import { TrainingDataPipeline } from './training-data-pipeline.js';

export { MemoryStore } from './memory-store.js';
export { IngestPipeline } from './ingest-pipeline.js';
export { RetrievalLadder } from './retrieval-ladder.js';
export { WeightCalculator } from './weight-calculator.js';
export { ConflictResolver } from './conflict-resolver.js';
export { DevelopmentalStageManager, STAGES } from './developmental-stages.js';
export { JoltEncoder } from './jolt-encoder.js';
export { PromotionUtility } from './promotion-utility.js';
export { VerificationGate } from './verification-gate.js';
export { D0D5Benchmark } from './d0-d5-benchmark.js';
export { FailureMitigations } from './failure-mitigations.js';
export { TrainingDataPipeline } from './training-data-pipeline.js';

/**
 * Create a fully wired WDMA memory system with one call.
 *
 * @param {Object} config - Configuration options (see ADOPTION_GUIDE.md for full reference)
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

    // Jolt-based encoding (replaces naive gate threshold)
    this.jolt = new JoltEncoder({
      baseThreshold: config.joltBaseThreshold ?? config.gateThreshold,
      growthRate: config.joltGrowthRate,
      maxThreshold: config.joltMaxThreshold,
      predictFn: config.joltPredictFn,
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

    // Promotion utility (formalized U(m) objective)
    this.promotion = new PromotionUtility({
      alpha: config.promotionAlpha,
      beta: config.promotionBeta,
      gamma: config.promotionGamma,
      delta: config.promotionDelta,
      lambda: config.promotionLambda,
      maxErrorRate: config.maxErrorRate,
      maxBudgetUsd: config.maxBudgetUsd,
      maxStalenessMs: config.maxStalenessMs,
      layerThresholds: config.layerThresholds,
    });

    // Verification gate (correctness scoring)
    this.verification = new VerificationGate(this.store, {
      passThreshold: config.verificationPassThreshold,
      customVerifier: config.customVerifier,
      trustedSources: config.trustedSources,
    });

    // Failure-mode mitigations
    this.mitigations = new FailureMitigations({
      disconfirmationBonus: config.disconfirmationBonus,
      stalenessHalfLifeMs: config.stalenessHalfLifeMs,
      causalKeywords: config.causalKeywords,
      probationConfidenceCap: config.probationConfidenceCap,
    });

    // Developmental stage manager
    this.stages = new DevelopmentalStageManager(this.store, this.weights, {
      initialStage: config.initialStage,
      thresholds: config.stageThresholds,
      onStageChange: config.onStageChange,
    });

    // D0-D5 benchmark generator
    this.benchmark = new D0D5Benchmark({ seed: config.benchmarkSeed });

    // Training data pipeline: memory IS training data
    this.training = new TrainingDataPipeline({
      maxReplaySize: config.maxReplaySize,
      maxInteractions: config.maxInteractions,
      minConfidenceForPositive: config.minConfidenceForPositive,
      maxConfidenceForNegative: config.maxConfidenceForNegative,
    });

    // Config flag: use jolt encoding for ingest gate
    this._useJoltEncoding = config.useJoltEncoding ?? true;

    // Queue of interaction IDs for feedback attachment (FIFO)
    this._interactionQueue = [];
  }

  // ── Convenience API ─────────────────────────────────────────────

  /**
   * Ingest a memory event (text, fact, or structured record).
   * Runs through jolt encoding check, then the full I0->I1->I2->I3 pipeline.
   * Applies failure mitigations (probationary routing for causal claims).
   */
  remember(event) {
    // Jolt encoding: check if this event is surprising enough to store
    if (this._useJoltEncoding) {
      const domain = event.domain || (event.tags && event.tags[0]) || event.type || 'general';
      const existingMemories = this.store.search(event.fact || event.text || event.content || '', { limit: 10 });
      const joltResult = this.jolt.evaluate(event, existingMemories);

      if (!joltResult.encode) {
        // Not surprising enough — skip encoding
        return null;
      }
    }

    const record = this.ingest.ingest(event);
    if (!record) return null;

    // Apply probationary routing for causal claims
    const probation = this.mitigations.checkProbationary(record);
    if (probation.probationary) {
      if (probation.routeOverride) {
        record._promotionLayer = probation.routeOverride;
      }
      if (probation.confidenceCap) {
        record.confidence = Math.min(record.confidence, probation.confidenceCap);
      }
      this.store.put(record); // update with capped confidence
    }

    this.stages.recordIngestion();
    return record;
  }

  /**
   * Ingest multiple events at once.
   */
  rememberAll(events) {
    return events.map(e => this.remember(e)).filter(Boolean);
  }

  /**
   * Retrieve memories relevant to a query.
   * Automatically escalates retrieval tier based on confidence/stakes.
   * Applies verification gate, failure mitigations, and weight ranking.
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

    // Verification gate: score correctness for each memory
    const verifications = await this.verification.verifyBatch(resolved);
    result.metadata.verifications = verifications.map((v, i) => ({
      id: resolved[i]?.id,
      correctness: v.correctness,
      passed: v.passed,
      flags: v.flags,
    }));

    // Rank by weight with failure mitigations
    const ranked = resolved.map((mem, i) => {
      const weightResult = this.weights.compute(mem, { queryText: q.text, tier: result.tier });
      const existingInDomain = resolved.filter(m => m.id !== mem.id);

      // Apply failure mitigations
      const mitigated = this.mitigations.applyAll(mem, existingInDomain, weightResult.weight);

      return {
        memory: mem,
        weight: mitigated.weight,
        correctness: verifications[i]?.correctness ?? 0.5,
        mitigations: mitigated.mitigations,
        components: weightResult.components,
      };
    });

    ranked.sort((a, b) => b.weight - a.weight);
    result.memories = ranked.map(r => r.memory);
    result.metadata.weights = ranked.map(r => ({
      id: r.memory.id,
      weight: r.weight,
      correctness: r.correctness,
      components: r.components,
    }));

    // Record access for reinforcement
    for (const m of result.memories) {
      this.weights.recordAccess(m.id);
      this.stages.recordReuse(m.id);
    }

    this.stages.recordQuery(result.cost?.costUsd || 0);

    // Log interaction for training data pipeline
    const interactionId = this.training.logInteraction({
      query: q.text,
      retrievedMemories: result.memories,
      answer: result.memories.length > 0 ? result.memories[0].fact : '',
      tier: result.tier,
      confidence: ranked.length > 0 ? ranked[0].weight : 0,
      latencyMs: result.cost?.latencyMs || 0,
      metadata: { uncertainty, conflicts: conflicts.length },
    });
    this._interactionQueue.push(interactionId);

    return result;
  }

  /**
   * Verify a specific memory's correctness.
   */
  async verify(memory) {
    return this.verification.verify(memory);
  }

  /**
   * Compute promotion utility for a memory.
   * Returns the target layer and whether to promote/demote.
   */
  computePromotion(memory, signals = {}) {
    return this.promotion.compute(memory, signals);
  }

  /**
   * Provide feedback on the last retrieval result.
   * Also records probation outcomes for causal claims.
   */
  feedback(correct, score = null, memoryId = null) {
    this.stages.recordFeedback(correct, score);

    // Attach label to training pipeline (dequeue oldest pending interaction)
    if (this._interactionQueue.length > 0) {
      const interactionId = this._interactionQueue.shift();
      this.training.attachFeedback(interactionId, correct, score);
    }

    if (memoryId) {
      this.mitigations.recordProbationOutcome(memoryId, correct);
    }
  }

  /**
   * Generate D0-D5 benchmark cases from current memory store.
   */
  generateBenchmark(opts = {}) {
    const memories = this.store.toArray();
    return this.benchmark.generate(memories, opts);
  }

  /**
   * Generate a complete training data package from all accumulated experience.
   * Memory IS training data — this exports the agent's learning for fine-tuning.
   */
  generateTrainingData() {
    return this.training.generateFullPackage(this.store.toArray());
  }

  /**
   * Generate a D0-D5 training curriculum from accumulated experience.
   */
  generateCurriculum() {
    return this.training.generateCurriculum(this.store.toArray(), this.training._interactions);
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
   * Get a full system health snapshot including all subsystems.
   */
  health() {
    return {
      memoryCount: this.store.size,
      stage: this.stages.stage,
      stageCapabilities: this.stages.getCapabilities(),
      stageMetrics: this.stages.metrics,
      ingestStats: this.ingest.stats,
      retrievalStats: this.retrieval.stats,
      joltStats: this.jolt.stats,
      verificationStats: this.verification.stats,
      mitigationStats: this.mitigations.stats,
      promotionLog: this.promotion.promotionLog.slice(-10), // last 10
      trainingStats: this.training.stats,
    };
  }
}
