/**
 * WDMA Verification Gate
 *
 * The correctness term is the least specified but most critical part of the
 * framework (per reviewer feedback). Without a strong gate, novelty and
 * recency can promote "polished garbage."
 *
 * This implements a minimal operational verification gate with three checks:
 * 1. Temporal consistency: does this memory's timeline make sense?
 * 2. Source attribution: can we trace this memory to a credible source?
 * 3. Contradiction handling: does this conflict with verified facts?
 *
 * The gate outputs a correctness score C(m) ∈ [0, 1] consumed by the
 * promotion utility function.
 */

export class VerificationGate {
  constructor(store, config = {}) {
    this.store = store;

    // Weight distribution across verification checks
    this.checkWeights = config.checkWeights ?? {
      temporal: 0.35,
      source: 0.25,
      contradiction: 0.40,
    };

    // Minimum correctness to pass the gate
    this.passThreshold = config.passThreshold ?? 0.3;

    // Custom verification function (e.g., LLM-backed fact-checking)
    this.customVerifier = config.customVerifier || null;

    // Known trusted sources (source IDs or patterns)
    this.trustedSources = new Set(config.trustedSources || []);

    // Verification cache: memoryId -> { score, timestamp, checks }
    this._cache = new Map();
    this._stats = { verified: 0, passed: 0, failed: 0, cached: 0 };
  }

  /**
   * Verify a memory record and return a correctness score.
   *
   * @param {Object} memory - Memory record to verify
   * @param {Object} context - { existingMemories?, queryContext? }
   * @returns {{ correctness: number, passed: boolean, checks: Object, flags: string[] }}
   */
  async verify(memory, context = {}) {
    // Check cache
    const cached = this._cache.get(memory.id);
    if (cached && Date.now() - cached.timestamp < 300000) { // 5-min cache
      this._stats.cached++;
      return cached.result;
    }

    this._stats.verified++;

    const existingMemories = context.existingMemories || this._getRelatedMemories(memory);
    const flags = [];

    // Run verification checks
    const temporalCheck = this._checkTemporalConsistency(memory, existingMemories, flags);
    const sourceCheck = this._checkSourceAttribution(memory, flags);
    const contradictionCheck = this._checkContradictions(memory, existingMemories, flags);

    // Custom verifier (e.g., LLM-backed)
    let customScore = null;
    if (this.customVerifier) {
      try {
        customScore = await this.customVerifier(memory, existingMemories);
      } catch {
        flags.push('custom_verifier_error');
      }
    }

    // Compute weighted correctness score
    let correctness;
    if (customScore !== null && typeof customScore === 'number') {
      // Blend custom verifier with structural checks (60/40 split)
      const structuralScore =
        this.checkWeights.temporal * temporalCheck.score +
        this.checkWeights.source * sourceCheck.score +
        this.checkWeights.contradiction * contradictionCheck.score;
      correctness = 0.6 * customScore + 0.4 * structuralScore;
    } else {
      correctness =
        this.checkWeights.temporal * temporalCheck.score +
        this.checkWeights.source * sourceCheck.score +
        this.checkWeights.contradiction * contradictionCheck.score;
    }

    correctness = Number(Math.max(0, Math.min(1, correctness)).toFixed(4));
    const passed = correctness >= this.passThreshold;

    if (passed) {
      this._stats.passed++;
    } else {
      this._stats.failed++;
    }

    const result = {
      correctness,
      passed,
      checks: {
        temporal: temporalCheck,
        source: sourceCheck,
        contradiction: contradictionCheck,
        ...(customScore !== null ? { custom: { score: customScore } } : {}),
      },
      flags,
    };

    // Cache result
    this._cache.set(memory.id, { result, timestamp: Date.now() });

    return result;
  }

  /**
   * Batch verify multiple memories.
   */
  async verifyBatch(memories, context = {}) {
    return Promise.all(memories.map(m => this.verify(m, context)));
  }

  // ── Check 1: Temporal Consistency ─────────────────────────────────

  /**
   * Validates timeline coherence:
   * - valid_from should exist and be parseable
   * - valid_to (if set) should be after valid_from
   * - Superseded records should have earlier timestamps
   * - No future-dated facts in past layer
   */
  _checkTemporalConsistency(memory, existingMemories, flags) {
    let score = 1.0;
    const details = {};

    // Check valid_from exists and is parseable
    if (!memory.time?.valid_from) {
      score -= 0.3;
      details.missingValidFrom = true;
      flags.push('missing_valid_from');
    } else {
      const validFrom = new Date(memory.time.valid_from);
      if (isNaN(validFrom.getTime())) {
        score -= 0.4;
        details.invalidDate = true;
        flags.push('invalid_date_format');
      } else {
        // Check valid_to is after valid_from
        if (memory.time.valid_to) {
          const validTo = new Date(memory.time.valid_to);
          if (!isNaN(validTo.getTime()) && validTo <= validFrom) {
            score -= 0.3;
            details.invalidWindow = true;
            flags.push('valid_to_before_valid_from');
          }
        }

        // Check future-dated facts in past layer
        if (memory.layer === 'past' && validFrom > new Date()) {
          score -= 0.2;
          details.futureDatedPast = true;
          flags.push('future_dated_in_past_layer');
        }
      }
    }

    // Check supersession chain temporal ordering
    if (memory.supersedes?.length > 0) {
      for (const parentId of memory.supersedes) {
        const parent = existingMemories.find(m => m.id === parentId) || this.store.get(parentId);
        if (parent?.time?.valid_from && memory.time?.valid_from) {
          const parentTime = new Date(parent.time.valid_from);
          const childTime = new Date(memory.time.valid_from);
          if (childTime < parentTime) {
            score -= 0.25;
            details.supersessionOrderViolation = true;
            flags.push('supersedes_newer_record');
          }
        }
      }
    }

    return { score: Math.max(0, score), details };
  }

  // ── Check 2: Source Attribution ────────────────────────────────────

  /**
   * Validates source provenance:
   * - Source metadata exists
   * - Source is from a known/trusted origin (if trust list provided)
   * - Session/message references are present
   */
  _checkSourceAttribution(memory, flags) {
    let score = 0.5; // baseline: partial credit for existence
    const details = {};

    if (!memory.source || Object.keys(memory.source).length === 0) {
      score = 0.2;
      details.noSource = true;
      flags.push('no_source_attribution');
    } else {
      // Has source metadata
      score = 0.6;

      // Check for session reference
      if (memory.source.session_id || memory.source.sessionId) {
        score += 0.15;
        details.hasSession = true;
      }

      // Check for message reference
      if (memory.source.message_ref || memory.source.messageRef) {
        score += 0.1;
        details.hasMessageRef = true;
      }

      // Check for timestamp
      if (memory.source.timestamp) {
        score += 0.05;
        details.hasTimestamp = true;
      }

      // Check trusted source
      if (this.trustedSources.size > 0) {
        const sourceId = memory.source.session_id || memory.source.sessionId || '';
        if (this.trustedSources.has(sourceId) || this.trustedSources.has(memory.source.type)) {
          score += 0.1;
          details.trustedSource = true;
        }
      }
    }

    return { score: Math.min(1, score), details };
  }

  // ── Check 3: Contradiction Handling ───────────────────────────────

  /**
   * Checks for unresolved contradictions:
   * - Does this fact conflict with verified existing memories?
   * - Is there an explicit supersession chain resolving the conflict?
   * - Are conflicting memories at different confidence levels?
   *
   * Returns HIGH score when:
   * - No contradictions found
   * - Contradictions exist but are properly resolved via supersession
   *
   * Returns LOW score when:
   * - Unresolved contradictions with high-confidence existing memories
   */
  _checkContradictions(memory, existingMemories, flags) {
    let score = 1.0;
    const details = { conflicts: [] };

    if (existingMemories.length === 0) return { score, details };

    for (const existing of existingMemories) {
      // Skip self
      if (existing.id === memory.id) continue;

      // Check for potential conflict: same type + layer, different fact
      if (existing.type === memory.type &&
          existing.layer === memory.layer &&
          existing.fact !== memory.fact &&
          !existing.time?.valid_to) { // still valid

        const similarity = this._factSimilarity(memory.fact, existing.fact);

        if (similarity > 0.3 && similarity < 0.95) {
          // Potential conflict detected
          const conflict = {
            withId: existing.id,
            withFact: existing.fact,
            similarity: Number(similarity.toFixed(3)),
          };

          // Check if properly resolved via supersession
          if (memory.supersedes?.includes(existing.id)) {
            conflict.resolved = 'supersession';
            // Mild penalty: conflict exists but is handled
            score -= 0.05;
          } else if (memory.confidence > existing.confidence + 0.2) {
            conflict.resolved = 'confidence_dominance';
            score -= 0.1;
          } else {
            conflict.resolved = false;
            // Significant penalty for unresolved contradiction
            score -= 0.3;
            flags.push(`unresolved_conflict_with_${existing.id}`);
          }

          details.conflicts.push(conflict);
        }
      }
    }

    return { score: Math.max(0, score), details };
  }

  // ── Helpers ───────────────────────────────────────────────────────

  _getRelatedMemories(memory) {
    // Get memories in the same layer + type
    const layerMemories = this.store.getByLayer(memory.layer || 'present');
    return layerMemories.filter(m => m.id !== memory.id && m.type === memory.type);
  }

  _factSimilarity(factA, factB) {
    const tokensA = new Set(factA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const tokensB = new Set(factB.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (tokensA.size === 0 && tokensB.size === 0) return 1;
    if (tokensA.size === 0 || tokensB.size === 0) return 0;
    let intersection = 0;
    for (const w of tokensA) {
      if (tokensB.has(w)) intersection++;
    }
    return intersection / (tokensA.size + tokensB.size - intersection);
  }

  /** Get verification statistics */
  get stats() {
    return { ...this._stats };
  }

  /** Clear verification cache */
  clearCache() {
    this._cache.clear();
  }
}
