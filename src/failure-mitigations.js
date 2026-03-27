/**
 * WDMA Failure-Mode Mitigations
 *
 * Implements architectural mitigations for the three key failure modes
 * identified in the paper:
 *
 * 1. Self-Confirmation Loops — memories reinforcing incorrect beliefs
 *    Mitigation: Disconfirmation bonus in weighting
 *
 * 2. Stale-Memory Contamination — outdated facts poisoning decisions
 *    Mitigation: Staleness penalty with progressive decay
 *
 * 3. False Causal Attribution — spurious causal links stored as fact
 *    Mitigation: Probationary routing into hypothesis layer (PESL/L3)
 *
 * Each mitigation hooks into the existing pipeline as a modifier function
 * that adjusts weights, routes, or flags before final storage/retrieval.
 */

export class FailureMitigations {
  constructor(config = {}) {
    // Disconfirmation bonus: extra weight for memories that challenge consensus
    this.disconfirmationBonus = config.disconfirmationBonus ?? 0.15;
    this.disconfirmationMinSupport = config.disconfirmationMinSupport ?? 0.3; // min confidence to get bonus

    // Staleness penalty
    this.stalenessHalfLifeMs = config.stalenessHalfLifeMs ?? 14 * 24 * 60 * 60 * 1000; // 14 days
    this.stalenessMaxPenalty = config.stalenessMaxPenalty ?? 0.6; // max penalty factor

    // Probationary routing
    this.causalKeywords = config.causalKeywords ?? [
      'because', 'caused', 'leads to', 'results in', 'therefore',
      'consequently', 'due to', 'implies', 'correlates', 'predicts',
    ];
    this.probationConfidenceCap = config.probationConfidenceCap ?? 0.6;
    this.probationMinVerifications = config.probationMinVerifications ?? 3;

    this._probationaryMemories = new Map(); // id -> { verifications: number, confirmations: number }
    this._stats = { disconfirmationBonuses: 0, stalenessAdjustments: 0, probationaryRouted: 0, promoted: 0, demoted: 0 };
  }

  // ── Mitigation 1: Disconfirmation Bonus ───────────────────────────

  /**
   * Apply disconfirmation bonus to a memory's weight.
   * Memories that challenge the current consensus get a weight boost,
   * preventing echo-chamber / self-confirmation loops.
   *
   * A memory qualifies for the bonus if:
   * - It contradicts at least one existing high-confidence memory
   * - Its own confidence is above the minimum support threshold
   * - It is not already the consensus view
   *
   * @param {Object} memory - The memory to evaluate
   * @param {Array} existingMemories - Current memories in the same domain
   * @param {number} currentWeight - The memory's current weight
   * @returns {{ adjustedWeight: number, bonusApplied: boolean, reason?: string }}
   */
  applyDisconfirmationBonus(memory, existingMemories, currentWeight) {
    if ((memory.confidence || 0) < this.disconfirmationMinSupport) {
      return { adjustedWeight: currentWeight, bonusApplied: false };
    }

    const isDisconfirming = this._isDisconfirming(memory, existingMemories);

    if (isDisconfirming) {
      this._stats.disconfirmationBonuses++;
      const bonus = this.disconfirmationBonus * (memory.confidence || 0.5);
      return {
        adjustedWeight: currentWeight + bonus,
        bonusApplied: true,
        reason: 'Memory challenges consensus; disconfirmation bonus applied to prevent self-confirmation loop.',
      };
    }

    return { adjustedWeight: currentWeight, bonusApplied: false };
  }

  _isDisconfirming(memory, existingMemories) {
    const factLower = (memory.fact || '').toLowerCase();

    for (const existing of existingMemories) {
      if (existing.id === memory.id) continue;
      if ((existing.confidence || 0) < 0.5) continue; // only count high-confidence existing memories

      const existFact = (existing.fact || '').toLowerCase();
      const similarity = this._wordOverlap(factLower, existFact);

      // Similar topic but different conclusion
      if (similarity > 0.3 && similarity < 0.85) {
        // Check for negation or contradiction signals
        const hasNegation = /\bnot\b|\bnever\b|\bno\b|\binstead\b|\bchanged\b/.test(factLower);
        const hasOpposite = memory.supersedes?.includes(existing.id);
        if (hasNegation || hasOpposite) return true;
      }
    }

    return false;
  }

  // ── Mitigation 2: Staleness Penalty ───────────────────────────────

  /**
   * Apply staleness penalty to a memory's weight.
   * Older memories without recent access or reconfirmation get penalized
   * progressively, preventing stale contamination.
   *
   * Penalty = min(maxPenalty, 1 - 0.5^(age / halfLife))
   *
   * @param {Object} memory - The memory to evaluate
   * @param {Object} opts - { now?: Date, lastAccessTime?: string }
   * @returns {{ adjustedWeight: number, penalty: number, stale: boolean }}
   */
  applyStaleness(memory, currentWeight, opts = {}) {
    const now = opts.now || new Date();
    const referenceTime = opts.lastAccessTime || memory.time?.valid_from;

    if (!referenceTime) {
      return { adjustedWeight: currentWeight, penalty: 0, stale: false };
    }

    const ageMs = now.getTime() - new Date(referenceTime).getTime();
    if (ageMs <= 0) {
      return { adjustedWeight: currentWeight, penalty: 0, stale: false };
    }

    // Progressive penalty: approaches maxPenalty as age increases
    const rawPenalty = 1 - Math.pow(0.5, ageMs / this.stalenessHalfLifeMs);
    const penalty = Math.min(rawPenalty, this.stalenessMaxPenalty);

    // Critical and high-priority memories decay slower
    const priorityShield = { critical: 0.8, high: 0.5, medium: 0.2, low: 0 };
    const shield = priorityShield[memory.priority] ?? 0;
    const effectivePenalty = penalty * (1 - shield);

    const adjustedWeight = currentWeight * (1 - effectivePenalty);
    const stale = effectivePenalty > 0.3;

    if (effectivePenalty > 0.05) {
      this._stats.stalenessAdjustments++;
    }

    return {
      adjustedWeight: Number(adjustedWeight.toFixed(4)),
      penalty: Number(effectivePenalty.toFixed(4)),
      stale,
    };
  }

  // ── Mitigation 3: Probationary Routing ────────────────────────────

  /**
   * Check if a memory contains causal claims and should be routed
   * to the hypothesis layer (L3/PESL) instead of factual memory.
   *
   * Causal hypotheses are held on probation until they accumulate
   * enough confirmations from downstream task outcomes.
   *
   * @param {Object} memory - The memory to evaluate
   * @returns {{ probationary: boolean, reason?: string, routeOverride?: string, confidenceCap?: number }}
   */
  checkProbationary(memory) {
    const fact = (memory.fact || '').toLowerCase();

    // Check for causal language
    const hasCausalClaim = this.causalKeywords.some(kw => fact.includes(kw));

    if (!hasCausalClaim) {
      return { probationary: false };
    }

    // If it's already in hypothesis layer, check if it can be promoted
    const probation = this._probationaryMemories.get(memory.id);
    if (probation) {
      if (probation.confirmations >= this.probationMinVerifications) {
        this._stats.promoted++;
        this._probationaryMemories.delete(memory.id);
        return {
          probationary: false,
          reason: `Promoted from probation after ${probation.confirmations} confirmations.`,
        };
      }
      return {
        probationary: true,
        reason: `On probation: ${probation.confirmations}/${this.probationMinVerifications} confirmations needed.`,
        confidenceCap: this.probationConfidenceCap,
      };
    }

    // New causal claim: route to hypothesis layer
    this._probationaryMemories.set(memory.id, { verifications: 0, confirmations: 0, createdAt: Date.now() });
    this._stats.probationaryRouted++;

    return {
      probationary: true,
      routeOverride: 'L3_hypothesis',
      reason: 'Causal claim detected; routed to hypothesis layer for probationary verification.',
      confidenceCap: this.probationConfidenceCap,
    };
  }

  /**
   * Record a confirmation or disconfirmation for a probationary memory.
   *
   * @param {string} memoryId
   * @param {boolean} confirmed - True if downstream task confirmed the causal claim
   */
  recordProbationOutcome(memoryId, confirmed) {
    const probation = this._probationaryMemories.get(memoryId);
    if (!probation) return;

    probation.verifications++;
    if (confirmed) {
      probation.confirmations++;
    } else {
      // Disconfirmation: reduce confirmations (can go negative)
      probation.confirmations = Math.max(0, probation.confirmations - 1);
    }
  }

  /**
   * Apply all three mitigations to a memory and return adjusted state.
   *
   * @param {Object} memory - Memory record
   * @param {Array} existingMemories - Related memories
   * @param {number} currentWeight - Current weight
   * @param {Object} opts - { now?, lastAccessTime? }
   * @returns {{ weight: number, probationary: boolean, stale: boolean, mitigations: Object }}
   */
  applyAll(memory, existingMemories, currentWeight, opts = {}) {
    const disconf = this.applyDisconfirmationBonus(memory, existingMemories, currentWeight);
    const staleness = this.applyStaleness(memory, disconf.adjustedWeight, opts);
    const probation = this.checkProbationary(memory);

    // If probationary, cap confidence
    if (probation.probationary && probation.confidenceCap) {
      memory.confidence = Math.min(memory.confidence || 1, probation.confidenceCap);
    }

    return {
      weight: staleness.adjustedWeight,
      probationary: probation.probationary,
      stale: staleness.stale,
      mitigations: {
        disconfirmation: disconf,
        staleness,
        probation,
      },
    };
  }

  /** Get mitigation statistics */
  get stats() {
    return {
      ...this._stats,
      probationaryCount: this._probationaryMemories.size,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _wordOverlap(a, b) {
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
  }
}
