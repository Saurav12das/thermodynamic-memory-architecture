/**
 * WDMA Retrieval Ladder
 * Tiered retrieval: R0 (cheap) -> R1 (timeline) -> R2 (context/trust) -> R3 (multi-agent)
 *
 * Each tier adds resolution power at higher cost. Escalation is driven by
 * confidence thresholds, contradiction probability, stakes, and irreversibility.
 */

/**
 * @typedef {Object} RetrievalResult
 * @property {Array} memories - Retrieved memory records
 * @property {number} confidence - Aggregated confidence score (0-1)
 * @property {string} tier - Which retrieval tier was used (R0-R3)
 * @property {Object} cost - { tokens, latencyMs, calls }
 * @property {Object} metadata - Additional context from retrieval
 */

export class RetrievalLadder {
  constructor(store, config = {}) {
    this.store = store;

    // Escalation thresholds
    this.confidenceFloor = config.confidenceFloor ?? 0.6;
    this.contradictionCeiling = config.contradictionCeiling ?? 0.3;
    this.maxTier = config.maxTier ?? 'R3';

    // Cost caps per tier
    this.tierCaps = config.tierCaps ?? {
      R0: { maxCalls: 1, maxTokens: 500, timeoutMs: 2000 },
      R1: { maxCalls: 2, maxTokens: 1000, timeoutMs: 4000 },
      R2: { maxCalls: 2, maxTokens: 2000, timeoutMs: 6000 },
      R3: { maxCalls: 4, maxTokens: 4000, timeoutMs: 10000 },
    };

    // Custom tier handlers (agents supply their own LLM-backed resolvers)
    this.tierHandlers = {
      R0: config.r0Handler || this._defaultR0.bind(this),
      R1: config.r1Handler || this._defaultR1.bind(this),
      R2: config.r2Handler || this._defaultR2.bind(this),
      R3: config.r3Handler || this._defaultR3.bind(this),
    };

    this._stats = { queries: 0, tierUsage: { R0: 0, R1: 0, R2: 0, R3: 0 } };
  }

  /**
   * Main retrieval entry point.
   * Starts at R0 and escalates based on the query context.
   *
   * @param {Object} query - { text, stakes?, irreversibility?, context? }
   * @returns {RetrievalResult}
   */
  async retrieve(query) {
    this._stats.queries++;
    const tiers = ['R0', 'R1', 'R2', 'R3'];
    const maxIdx = tiers.indexOf(this.maxTier);

    let result = null;

    for (let i = 0; i <= maxIdx; i++) {
      const tier = tiers[i];
      const handler = this.tierHandlers[tier];
      const caps = this.tierCaps[tier];

      const startTime = Date.now();
      result = await handler(query, result, caps);
      result.cost = result.cost || {};
      result.cost.latencyMs = Date.now() - startTime;
      result.tier = tier;

      this._stats.tierUsage[tier]++;

      // Check if we should escalate
      if (!this._shouldEscalate(result, query, i, maxIdx)) {
        break;
      }
    }

    return result;
  }

  /**
   * Determine whether to escalate to the next tier.
   */
  _shouldEscalate(result, query, currentIdx, maxIdx) {
    if (currentIdx >= maxIdx) return false;

    const stakes = query.stakes || 'low';
    const irreversibility = query.irreversibility || 'low';

    // Always escalate if no results found
    if (!result.memories || result.memories.length === 0) return true;

    // Escalate if confidence below floor
    if (result.confidence < this.confidenceFloor) return true;

    // Escalate if contradiction probability is high
    if (result.metadata?.contradictionProbability > this.contradictionCeiling) return true;

    // Escalate for high-stakes or irreversible decisions
    if (stakes === 'high' || stakes === 'critical') return true;
    if (irreversibility === 'high') return true;

    return false;
  }

  // ── Default Tier Handlers ─────────────────────────────────────────
  // These are basic implementations. Agents should override with their
  // own LLM-backed versions via config.r0Handler, etc.

  /** R0: Cheap keyword/embedding retrieval */
  _defaultR0(query, _prev, _caps) {
    const text = query.text || query;
    const memories = this.store.search(text, { limit: 5 });

    const confidence = memories.length > 0
      ? Math.max(...memories.map(m => m.confidence || 0))
      : 0;

    const hasContradictions = this._detectContradictions(memories);

    return {
      memories,
      confidence,
      tier: 'R0',
      cost: { tokens: memories.length * 50, calls: 1 },
      metadata: {
        contradictionProbability: hasContradictions ? 0.7 : 0.1,
        source: 'keyword_search',
      },
    };
  }

  /** R1: Add timeline resolution - resolve supersession chains */
  _defaultR1(query, prev, _caps) {
    const memories = (prev?.memories || []).map(m => {
      const resolved = this.store.resolveChain(m.id);
      return resolved || m;
    });

    // Deduplicate after chain resolution
    const seen = new Set();
    const unique = memories.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });

    // Sort by temporal validity (newest first)
    unique.sort((a, b) =>
      (b.time?.valid_from || '').localeCompare(a.time?.valid_from || '')
    );

    const confidence = unique.length > 0
      ? Math.max(...unique.map(m => m.confidence || 0)) * 1.1 // slight boost for temporal resolution
      : 0;

    return {
      memories: unique,
      confidence: Math.min(confidence, 1.0),
      tier: 'R1',
      cost: { tokens: (prev?.cost?.tokens || 0) + unique.length * 30, calls: 2 },
      metadata: {
        contradictionProbability: this._detectContradictions(unique) ? 0.4 : 0.05,
        source: 'timeline_resolved',
      },
    };
  }

  /** R2: Add context/trust filtering */
  _defaultR2(query, prev, _caps) {
    const memories = (prev?.memories || []).filter(m => {
      // Filter out low-confidence memories for high-trust queries
      if (query.stakes === 'high' && m.confidence < 0.5) return false;
      // Filter out expired records
      if (m.time?.valid_to && new Date(m.time.valid_to) < new Date()) return false;
      return true;
    });

    const confidence = memories.length > 0
      ? memories.reduce((sum, m) => sum + (m.confidence || 0), 0) / memories.length
      : 0;

    return {
      memories,
      confidence: Math.min(confidence * 1.2, 1.0),
      tier: 'R2',
      cost: { tokens: (prev?.cost?.tokens || 0) + 200, calls: 2 },
      metadata: {
        contradictionProbability: this._detectContradictions(memories) ? 0.2 : 0.02,
        source: 'context_trust_filtered',
        trustLevel: query.stakes === 'high' ? 'elevated' : 'standard',
      },
    };
  }

  /** R3: Full multi-agent retrieval (placeholder - agents implement their own) */
  _defaultR3(query, prev, _caps) {
    // In production, this would fan out to multiple specialized retrieval agents.
    // The default just re-ranks and boosts confidence.
    const memories = (prev?.memories || []).sort((a, b) => {
      const scoreA = (a.confidence || 0) * (a.priority === 'critical' ? 2 : a.priority === 'high' ? 1.5 : 1);
      const scoreB = (b.confidence || 0) * (b.priority === 'critical' ? 2 : b.priority === 'high' ? 1.5 : 1);
      return scoreB - scoreA;
    });

    return {
      memories,
      confidence: memories.length > 0 ? 0.9 : 0,
      tier: 'R3',
      cost: { tokens: (prev?.cost?.tokens || 0) + 500, calls: 4 },
      metadata: {
        contradictionProbability: 0.01,
        source: 'multi_agent_retrieval',
        warning: 'Using default R3 handler. Supply config.r3Handler for production multi-agent retrieval.',
      },
    };
  }

  /** Simple contradiction detector: checks if memories have conflicting facts */
  _detectContradictions(memories) {
    if (memories.length < 2) return false;
    // Check for supersession without resolution
    for (const m of memories) {
      if (m.supersedes?.length > 0) {
        for (const parentId of m.supersedes) {
          const parent = memories.find(x => x.id === parentId);
          if (parent && !parent.time?.valid_to) return true;
        }
      }
    }
    return false;
  }

  /** Get retrieval statistics */
  get stats() {
    return { ...this._stats, tierUsage: { ...this._stats.tierUsage } };
  }
}
