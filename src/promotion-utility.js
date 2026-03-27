/**
 * WDMA Promotion Utility Function
 *
 * Formalizes the governing objective from the paper:
 *
 *   U(m) = α·R(m) + β·N(m) + γ·C(m) + δ·V(m) - λ·A(m)
 *
 * Where:
 *   R(m) = Recency/relevance signal
 *   N(m) = Novelty (information gain from encoding)
 *   C(m) = Correctness (verification confidence)
 *   V(m) = Value (downstream task utility estimate)
 *   A(m) = Access cost (compute, tokens, latency)
 *
 * Reviewer feedback upgrade: cast routing and promotion decisions as
 * maximizing expected downstream task utility under compute and error
 * constraints, not just a linear combination.
 *
 * Constrained formulation:
 *   max_m  E[TaskUtility(m)] - λ·Cost(m)
 *   s.t.   ErrorRate(m) ≤ ε_max
 *          Cost(m) ≤ budget
 *          Staleness(m) ≤ τ_max
 */

export class PromotionUtility {
  constructor(config = {}) {
    // Linear combination weights (sum to ~1.0 before penalty)
    this.alpha = config.alpha ?? 0.20;   // recency/relevance
    this.beta = config.beta ?? 0.20;     // novelty
    this.gamma = config.gamma ?? 0.25;   // correctness
    this.delta = config.delta ?? 0.20;   // downstream value
    this.lambda = config.lambda ?? 0.15; // cost penalty

    // Constraints
    this.maxErrorRate = config.maxErrorRate ?? 0.1;     // ε_max
    this.maxBudgetUsd = config.maxBudgetUsd ?? 0.01;    // per-query budget cap
    this.maxStalenessMs = config.maxStalenessMs ?? 30 * 24 * 60 * 60 * 1000; // 30 days

    // Promotion thresholds per layer
    this.layerThresholds = config.layerThresholds ?? {
      L0_buffer: 0.0,    // everything starts here
      L1_working: 0.15,  // low bar to enter working memory
      L2_episodic: 0.30, // moderate utility for episodic storage
      L3_hypothesis: 0.45, // higher bar for hypothesis/simulation
      L4_procedural: 0.60, // high utility for policy/meta-response
      L5_cultural: 0.75,   // highest bar for deployment priors
    };

    // Decay rates per layer (memories decay faster in lower layers)
    this.layerDecayRates = config.layerDecayRates ?? {
      L0_buffer: 1.0,       // fast decay
      L1_working: 0.5,      // moderate decay
      L2_episodic: 0.1,     // slow decay
      L3_hypothesis: 0.2,   // moderate (hypotheses should be tested or discarded)
      L4_procedural: 0.02,  // very slow (policies are stable)
      L5_cultural: 0.005,   // near-permanent
    };

    // Track promotion history
    this._promotionLog = [];
  }

  /**
   * Compute the full promotion utility for a memory.
   *
   * @param {Object} memory - Memory record
   * @param {Object} signals - {
   *   relevance: 0-1,      // from weight calculator
   *   novelty: 0-1,        // from jolt encoder
   *   correctness: 0-1,    // from verification gate
   *   taskValue: 0-1,      // estimated downstream utility
   *   accessCost: 0-1,     // normalized compute cost
   *   errorRate?: number,  // observed error rate for this memory
   *   staleness?: number,  // age in ms
   *   costUsd?: number,    // actual dollar cost
   * }
   * @returns {{ utility: number, layer: string, promote: boolean, demote: boolean, constraints: Object }}
   */
  compute(memory, signals = {}) {
    const R = signals.relevance ?? 0.5;
    const N = signals.novelty ?? 0.5;
    const C = signals.correctness ?? 0.5;
    const V = signals.taskValue ?? 0.5;
    const A = signals.accessCost ?? 0.1;

    // Core utility: U(m) = αR + βN + γC + δV - λA
    const rawUtility = this.alpha * R + this.beta * N + this.gamma * C + this.delta * V - this.lambda * A;

    // Constraint checks
    const constraints = this._checkConstraints(memory, signals);

    // Apply constraint penalties (soft constraints via penalty terms)
    let constrainedUtility = rawUtility;
    if (constraints.errorViolation) {
      constrainedUtility *= (1 - constraints.errorExcess); // proportional penalty
    }
    if (constraints.budgetViolation) {
      constrainedUtility *= 0.5; // heavy penalty for budget violation
    }
    if (constraints.stalenessViolation) {
      constrainedUtility *= (1 - constraints.stalenessExcess * 0.5); // gradual staleness penalty
    }

    // Determine target layer based on utility
    const targetLayer = this._determineLayer(constrainedUtility);
    const currentLayer = memory._promotionLayer || 'L0_buffer';
    const currentLayerIdx = this._layerIndex(currentLayer);
    const targetLayerIdx = this._layerIndex(targetLayer);

    const promote = targetLayerIdx > currentLayerIdx;
    const demote = targetLayerIdx < currentLayerIdx;

    return {
      utility: Number(constrainedUtility.toFixed(4)),
      rawUtility: Number(rawUtility.toFixed(4)),
      currentLayer,
      targetLayer,
      promote,
      demote,
      layerDelta: targetLayerIdx - currentLayerIdx,
      constraints,
      components: {
        relevance: { weight: this.alpha, signal: R, contribution: Number((this.alpha * R).toFixed(4)) },
        novelty: { weight: this.beta, signal: N, contribution: Number((this.beta * N).toFixed(4)) },
        correctness: { weight: this.gamma, signal: C, contribution: Number((this.gamma * C).toFixed(4)) },
        taskValue: { weight: this.delta, signal: V, contribution: Number((this.delta * V).toFixed(4)) },
        accessCost: { weight: this.lambda, signal: A, contribution: Number((-this.lambda * A).toFixed(4)) },
      },
    };
  }

  /**
   * Execute promotion/demotion for a memory record.
   * Returns the updated memory with new _promotionLayer.
   */
  applyPromotion(memory, signals = {}) {
    const result = this.compute(memory, signals);

    if (result.promote || result.demote) {
      const oldLayer = result.currentLayer;
      memory._promotionLayer = result.targetLayer;
      memory._promotionUtility = result.utility;
      memory._lastPromotionTime = new Date().toISOString();

      this._promotionLog.push({
        memoryId: memory.id,
        from: oldLayer,
        to: result.targetLayer,
        utility: result.utility,
        direction: result.promote ? 'promote' : 'demote',
        timestamp: new Date().toISOString(),
      });
    }

    return { memory, result };
  }

  /**
   * Compute expected downstream task utility for a set of retrieved memories.
   * This is the constrained optimization objective:
   *   max E[TaskUtility] - λ·TotalCost  s.t. constraints
   */
  optimizeRetrieval(candidates, signals = {}) {
    const scored = candidates.map(m => ({
      memory: m,
      ...this.compute(m, {
        ...signals,
        relevance: signals.relevanceFn ? signals.relevanceFn(m) : (signals.relevance ?? 0.5),
        correctness: signals.correctnessFn ? signals.correctnessFn(m) : (signals.correctness ?? 0.5),
      }),
    }));

    // Sort by utility descending
    scored.sort((a, b) => b.utility - a.utility);

    // Greedy selection under budget constraint
    let totalCost = 0;
    const selected = [];
    for (const item of scored) {
      const itemCost = item.components.accessCost.signal * (this.maxBudgetUsd || 0.01);
      if (totalCost + itemCost <= (this.maxBudgetUsd || Infinity)) {
        selected.push(item);
        totalCost += itemCost;
      }
    }

    return {
      selected: selected.map(s => s.memory),
      totalUtility: selected.reduce((sum, s) => sum + s.utility, 0),
      totalCost,
      details: selected,
    };
  }

  /**
   * Get the natural decay rate for a memory at its current layer.
   * Used by the weight calculator to adjust recency scoring.
   */
  getDecayRate(memory) {
    const layer = memory._promotionLayer || 'L0_buffer';
    return this.layerDecayRates[layer] ?? 1.0;
  }

  // ── Constraint Checking ───────────────────────────────────────────

  _checkConstraints(memory, signals) {
    const errorRate = signals.errorRate ?? 0;
    const costUsd = signals.costUsd ?? 0;
    const staleness = signals.staleness ??
      (memory.time?.valid_from ? Date.now() - new Date(memory.time.valid_from).getTime() : 0);

    const errorViolation = errorRate > this.maxErrorRate;
    const budgetViolation = costUsd > this.maxBudgetUsd;
    const stalenessViolation = staleness > this.maxStalenessMs;

    return {
      errorViolation,
      errorExcess: errorViolation ? Math.min((errorRate - this.maxErrorRate) / this.maxErrorRate, 1) : 0,
      budgetViolation,
      budgetExcess: budgetViolation ? (costUsd - this.maxBudgetUsd) / this.maxBudgetUsd : 0,
      stalenessViolation,
      stalenessExcess: stalenessViolation ? Math.min((staleness - this.maxStalenessMs) / this.maxStalenessMs, 1) : 0,
      allSatisfied: !errorViolation && !budgetViolation && !stalenessViolation,
    };
  }

  // ── Layer Routing ─────────────────────────────────────────────────

  _determineLayer(utility) {
    const layers = Object.entries(this.layerThresholds)
      .sort((a, b) => b[1] - a[1]); // highest threshold first

    for (const [layer, threshold] of layers) {
      if (utility >= threshold) return layer;
    }
    return 'L0_buffer';
  }

  _layerIndex(layer) {
    const order = ['L0_buffer', 'L1_working', 'L2_episodic', 'L3_hypothesis', 'L4_procedural', 'L5_cultural'];
    return order.indexOf(layer);
  }

  /** Get promotion history */
  get promotionLog() {
    return [...this._promotionLog];
  }
}
