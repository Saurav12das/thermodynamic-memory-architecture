/**
 * WDMA Weight Calculator
 * Computes composite weights for memory records based on multiple signals:
 * - Recency (temporal decay)
 * - Relevance (semantic match score)
 * - Reliability (source confidence + consistency)
 * - Reinforcement (access frequency / reuse count)
 * - Cost-efficiency (utility-per-dollar ratio)
 *
 * The weighting formula:
 *   W(m) = α·recency(m) + β·relevance(m) + γ·reliability(m) + δ·reinforcement(m)
 *
 * Where α + β + γ + δ = 1.0, and weights are configurable per deployment.
 * A cost multiplier adjusts the final score based on retrieval tier economics.
 */

const DEFAULT_WEIGHTS = {
  alpha: 0.25,  // recency
  beta: 0.35,   // relevance
  gamma: 0.25,  // reliability
  delta: 0.15,  // reinforcement
};

const DEFAULT_DECAY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export class WeightCalculator {
  constructor(config = {}) {
    const w = config.weights || {};
    this.alpha = w.alpha ?? DEFAULT_WEIGHTS.alpha;
    this.beta = w.beta ?? DEFAULT_WEIGHTS.beta;
    this.gamma = w.gamma ?? DEFAULT_WEIGHTS.gamma;
    this.delta = w.delta ?? DEFAULT_WEIGHTS.delta;

    this.decayHalfLifeMs = config.decayHalfLifeMs ?? DEFAULT_DECAY_HALF_LIFE_MS;

    // Cost multipliers by tier
    this.tierCostMultiplier = config.tierCostMultiplier ?? {
      R0: 1.0,   // no penalty
      R1: 0.95,  // slight cost
      R2: 0.85,  // moderate cost
      R3: 0.70,  // high cost
    };

    // Access counter (in-memory)
    this._accessCounts = new Map();
  }

  /**
   * Compute the composite weight for a memory record.
   *
   * @param {Object} memory - A normalized memory record
   * @param {Object} context - { queryText?, tier?, now? }
   * @returns {{ weight: number, components: Object }}
   */
  compute(memory, context = {}) {
    const now = context.now ? new Date(context.now) : new Date();

    const recency = this._recencyScore(memory, now);
    const relevance = this._relevanceScore(memory, context.queryText);
    const reliability = this._reliabilityScore(memory);
    const reinforcement = this._reinforcementScore(memory);

    const raw =
      this.alpha * recency +
      this.beta * relevance +
      this.gamma * reliability +
      this.delta * reinforcement;

    // Apply cost multiplier based on retrieval tier
    const tier = context.tier || 'R0';
    const costMult = this.tierCostMultiplier[tier] ?? 1.0;
    const weight = raw * costMult;

    return {
      weight: Number(weight.toFixed(4)),
      components: {
        recency: Number(recency.toFixed(4)),
        relevance: Number(relevance.toFixed(4)),
        reliability: Number(reliability.toFixed(4)),
        reinforcement: Number(reinforcement.toFixed(4)),
        costMultiplier: costMult,
        tier,
      },
    };
  }

  /**
   * Rank an array of memories by weight (descending).
   */
  rank(memories, context = {}) {
    return memories
      .map(m => ({ memory: m, ...this.compute(m, context) }))
      .sort((a, b) => b.weight - a.weight);
  }

  /**
   * Record an access for reinforcement scoring.
   */
  recordAccess(memoryId) {
    const count = this._accessCounts.get(memoryId) || 0;
    this._accessCounts.set(memoryId, count + 1);
  }

  // ── Component Scores ──────────────────────────────────────────────

  /** Exponential decay based on age */
  _recencyScore(memory, now) {
    const validFrom = memory.time?.valid_from;
    if (!validFrom) return 0.5;

    const ageMs = now.getTime() - new Date(validFrom).getTime();
    if (ageMs <= 0) return 1.0;

    // Exponential decay: score = 0.5^(age / halfLife)
    return Math.pow(0.5, ageMs / this.decayHalfLifeMs);
  }

  /** Simple keyword overlap relevance (agents should override with embeddings) */
  _relevanceScore(memory, queryText) {
    if (!queryText || !memory.fact) return 0.5;

    const queryWords = new Set(queryText.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const factWords = new Set(memory.fact.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    if (queryWords.size === 0) return 0.5;

    let hits = 0;
    for (const w of queryWords) {
      if (factWords.has(w)) hits++;
    }

    return hits / queryWords.size;
  }

  /** Confidence + priority as reliability proxy */
  _reliabilityScore(memory) {
    const confidence = memory.confidence ?? 0.5;
    const priorityBoost = { low: 0, medium: 0.1, high: 0.2, critical: 0.3 };
    const boost = priorityBoost[memory.priority] ?? 0;
    return Math.min(confidence + boost, 1.0);
  }

  /** Frequency of access as reinforcement signal */
  _reinforcementScore(memory) {
    const count = this._accessCounts.get(memory.id) || 0;
    // Logarithmic scaling: diminishing returns after many accesses
    return Math.min(Math.log2(count + 1) / 5, 1.0);
  }
}
