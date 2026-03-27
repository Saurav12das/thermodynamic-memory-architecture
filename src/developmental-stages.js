/**
 * WDMA Developmental Stages
 * Manages the self-evolution of the memory system through developmental phases:
 *
 * Stage 1 - REACTIVE:    Store and retrieve, no learning. Baseline behavior.
 * Stage 2 - REFLECTIVE:  Consolidate episodic -> semantic. Detect patterns.
 * Stage 3 - ADAPTIVE:    Reuse experience. Adjust weights from feedback.
 * Stage 4 - AUTONOMOUS:  Self-tune retrieval strategy. Proactive memory management.
 *
 * The system progresses through stages based on usage metrics and performance signals.
 */

export const STAGES = {
  REACTIVE: 'reactive',
  REFLECTIVE: 'reflective',
  ADAPTIVE: 'adaptive',
  AUTONOMOUS: 'autonomous',
};

const STAGE_ORDER = [STAGES.REACTIVE, STAGES.REFLECTIVE, STAGES.ADAPTIVE, STAGES.AUTONOMOUS];

/** Default promotion thresholds */
const DEFAULT_THRESHOLDS = {
  // Promote from REACTIVE -> REFLECTIVE after enough memories
  reactiveToReflective: { minMemories: 50, minQueries: 20 },
  // Promote from REFLECTIVE -> ADAPTIVE after pattern detection
  reflectiveToAdaptive: { minPatterns: 5, minReuseRate: 0.1 },
  // Promote from ADAPTIVE -> AUTONOMOUS after stable performance
  adaptiveToAutonomous: { minAdaptationSlope: 0.05, minUtilityPerDollar: 100 },
};

export class DevelopmentalStageManager {
  constructor(store, weightCalculator, config = {}) {
    this.store = store;
    this.weightCalculator = weightCalculator;
    this.currentStage = config.initialStage || STAGES.REACTIVE;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
    this.onStageChange = config.onStageChange || null;

    this._metrics = {
      totalQueries: 0,
      totalIngested: 0,
      patternsDetected: 0,
      reusedMemories: 0,
      feedbackEvents: 0,
      adaptationScores: [],     // rolling window of accuracy scores
      costPerQuery: [],          // rolling window of costs
    };

    this._consolidationLog = [];
  }

  /** Get the current stage */
  get stage() {
    return this.currentStage;
  }

  /** Get the numeric stage index (0-3) */
  get stageIndex() {
    return STAGE_ORDER.indexOf(this.currentStage);
  }

  /** Record a query event */
  recordQuery(costUsd = 0) {
    this._metrics.totalQueries++;
    if (costUsd > 0) this._metrics.costPerQuery.push(costUsd);
    // Keep rolling window at 100
    if (this._metrics.costPerQuery.length > 100) this._metrics.costPerQuery.shift();
    this._checkPromotion();
  }

  /** Record a memory ingestion */
  recordIngestion() {
    this._metrics.totalIngested++;
    this._checkPromotion();
  }

  /** Record that a memory was reused (found useful again) */
  recordReuse(memoryId) {
    this._metrics.reusedMemories++;
    this.weightCalculator.recordAccess(memoryId);
    this._checkPromotion();
  }

  /** Record feedback (correct/incorrect answer) */
  recordFeedback(correct, score = null) {
    this._metrics.feedbackEvents++;
    this._metrics.adaptationScores.push(score ?? (correct ? 1 : 0));
    if (this._metrics.adaptationScores.length > 100) this._metrics.adaptationScores.shift();
    this._checkPromotion();
  }

  /** Record a detected pattern */
  recordPattern(pattern) {
    this._metrics.patternsDetected++;
    this._consolidationLog.push({
      type: 'pattern',
      pattern,
      timestamp: new Date().toISOString(),
      stage: this.currentStage,
    });
    this._checkPromotion();
  }

  // ── Stage-Specific Behaviors ──────────────────────────────────────

  /**
   * Get the capabilities available at the current stage.
   * Agents use this to decide what operations are enabled.
   */
  getCapabilities() {
    const base = {
      canStore: true,
      canRetrieve: true,
      canConsolidate: false,
      canDetectPatterns: false,
      canReuseExperience: false,
      canSelfTune: false,
      canProactiveManage: false,
      maxRetrievalTier: 'R0',
    };

    switch (this.currentStage) {
      case STAGES.REFLECTIVE:
        return { ...base, canConsolidate: true, canDetectPatterns: true, maxRetrievalTier: 'R1' };
      case STAGES.ADAPTIVE:
        return { ...base, canConsolidate: true, canDetectPatterns: true, canReuseExperience: true, maxRetrievalTier: 'R2' };
      case STAGES.AUTONOMOUS:
        return { ...base, canConsolidate: true, canDetectPatterns: true, canReuseExperience: true, canSelfTune: true, canProactiveManage: true, maxRetrievalTier: 'R3' };
      default:
        return base;
    }
  }

  /**
   * Consolidate episodic memories into semantic summaries.
   * Only available from REFLECTIVE stage onward.
   */
  consolidate() {
    const caps = this.getCapabilities();
    if (!caps.canConsolidate) {
      return { ok: false, reason: `Consolidation not available at ${this.currentStage} stage` };
    }

    const layers = ['past', 'present'];
    const consolidated = [];

    for (const layer of layers) {
      const memories = this.store.getByLayer(layer);
      // Group by type
      const byType = {};
      for (const m of memories) {
        const t = m.type || 'event';
        if (!byType[t]) byType[t] = [];
        byType[t].push(m);
      }

      // For groups with > 3 related memories, create a consolidated semantic record
      for (const [type, group] of Object.entries(byType)) {
        if (group.length < 3) continue;

        const avgConfidence = group.reduce((s, m) => s + (m.confidence || 0), 0) / group.length;
        const allTags = [...new Set(group.flatMap(m => m.tags || []))];
        const latestFact = group.sort((a, b) =>
          (b.time?.valid_from || '').localeCompare(a.time?.valid_from || '')
        )[0].fact;

        const semantic = {
          layer: 'culture',
          type: 'consolidated_' + type,
          fact: `[Consolidated from ${group.length} ${type} records] ${latestFact}`,
          confidence: Math.min(avgConfidence * 1.1, 1.0),
          priority: 'medium',
          tags: [...allTags, 'consolidated'],
          supersedes: group.map(m => m.id),
          source: { consolidatedFrom: group.map(m => m.id), consolidatedAt: new Date().toISOString() },
        };

        this.store.put(semantic);
        consolidated.push(semantic);

        this._consolidationLog.push({
          type: 'consolidation',
          fromCount: group.length,
          toId: semantic.id,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return { ok: true, consolidated: consolidated.length, records: consolidated };
  }

  /** Get current metrics snapshot */
  get metrics() {
    const scores = this._metrics.adaptationScores;
    const costs = this._metrics.costPerQuery;

    return {
      ...this._metrics,
      currentStage: this.currentStage,
      stageIndex: this.stageIndex,
      reuseRate: this._metrics.totalQueries > 0
        ? this._metrics.reusedMemories / this._metrics.totalQueries
        : 0,
      adaptationSlope: this._computeSlope(scores),
      meanCostPerQuery: costs.length > 0
        ? costs.reduce((a, b) => a + b, 0) / costs.length
        : 0,
      utilityPerDollar: this._computeUtilityPerDollar(scores, costs),
    };
  }

  /** Get consolidation log */
  get consolidationHistory() {
    return [...this._consolidationLog];
  }

  // ── Internal ──────────────────────────────────────────────────────

  _checkPromotion() {
    const m = this.metrics;

    switch (this.currentStage) {
      case STAGES.REACTIVE: {
        const t = this.thresholds.reactiveToReflective;
        if (m.totalIngested >= t.minMemories && m.totalQueries >= t.minQueries) {
          this._promote(STAGES.REFLECTIVE);
        }
        break;
      }
      case STAGES.REFLECTIVE: {
        const t = this.thresholds.reflectiveToAdaptive;
        if (m.patternsDetected >= t.minPatterns && m.reuseRate >= t.minReuseRate) {
          this._promote(STAGES.ADAPTIVE);
        }
        break;
      }
      case STAGES.ADAPTIVE: {
        const t = this.thresholds.adaptiveToAutonomous;
        if (m.adaptationSlope >= t.minAdaptationSlope && m.utilityPerDollar >= t.minUtilityPerDollar) {
          this._promote(STAGES.AUTONOMOUS);
        }
        break;
      }
    }
  }

  _promote(newStage) {
    const oldStage = this.currentStage;
    this.currentStage = newStage;
    this._consolidationLog.push({
      type: 'promotion',
      from: oldStage,
      to: newStage,
      timestamp: new Date().toISOString(),
      metrics: { ...this.metrics },
    });
    this.onStageChange?.(oldStage, newStage, this.metrics);
  }

  _computeSlope(scores) {
    if (scores.length < 5) return 0;
    const recent = scores.slice(-10);
    const n = recent.length;
    const xMean = (n - 1) / 2;
    const yMean = recent.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (recent[i] - yMean);
      den += (i - xMean) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  _computeUtilityPerDollar(scores, costs) {
    if (scores.length === 0 || costs.length === 0) return 0;
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;
    return avgCost > 0 ? avgScore / avgCost : 0;
  }
}
