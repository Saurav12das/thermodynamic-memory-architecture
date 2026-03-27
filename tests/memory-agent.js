/**
 * WDMA Test Agent
 *
 * A simulated agent that uses WDMA memory to learn from experiences
 * and answer quiz questions. Two instances run with different configs
 * to compare memory behavior.
 */
import { createWDMA } from '../src/index.js';

export class MemoryAgent {
  constructor(name, config = {}) {
    this.name = name;
    this.wdma = createWDMA({
      persistPath: null, // in-memory for testing
      ...config,
    });
    this.experienceLog = [];
    this.answerLog = [];
  }

  /**
   * Experience a sequence of events (learn phase).
   */
  learn(events) {
    for (const event of events) {
      const result = this.wdma.remember(event);
      this.experienceLog.push({
        fact: event.fact,
        stored: result !== null,
        id: result?.id || null,
      });
    }
  }

  /**
   * Answer a quiz question using memory recall.
   * Returns the agent's answer along with metadata about how it was retrieved.
   */
  async answer(question) {
    const startTime = Date.now();

    // Determine stakes from the question
    const stakes = this._assessStakes(question.question);

    // Recall relevant memories
    const result = await this.wdma.recall({
      text: question.question,
      stakes,
    });

    const latencyMs = Date.now() - startTime;

    // Formulate answer from retrieved memories
    const answerText = this._formulateAnswer(question, result);

    // Determine confidence
    const confidence = this._assessConfidence(result);

    const entry = {
      questionId: question.id,
      level: question.level,
      question: question.question,
      answer: answerText,
      confidence,
      tier: result.tier,
      memoriesUsed: result.memories.length,
      memoriesFacts: result.memories.map(m => m.fact),
      uncertainty: result.metadata?.uncertainty || 0,
      conflictsDetected: (result.metadata?.conflicts || []).length,
      verificationScores: (result.metadata?.verifications || []).map(v => v.correctness),
      latencyMs,
    };

    this.answerLog.push(entry);
    return entry;
  }

  /**
   * Formulate an answer from retrieved memories.
   * This simulates what an LLM-backed agent would do.
   */
  _formulateAnswer(question, result) {
    const memories = result.memories;
    const uncertainty = result.metadata?.uncertainty || 0;
    const conflicts = result.metadata?.conflicts || [];

    // D5-style: no relevant memories → express uncertainty
    if (memories.length === 0) {
      return 'I have no information or memory about this topic. I am uncertain and cannot provide a confident answer.';
    }

    // D3-style: conflicts detected → surface them
    const unresolvedConflicts = conflicts.filter(c => !c.resolvedTo);
    if (unresolvedConflicts.length > 0) {
      const conflictFacts = memories.slice(0, 3).map(m => `"${m.fact}"`).join(' vs ');
      return `There appears to be a contradiction in my memory. I found conflicting records: ${conflictFacts}. Uncertainty is ${(uncertainty * 100).toFixed(0)}%. Both records exist but the conflict is not fully resolved.`;
    }

    // D5-style: low confidence memories → qualify the answer
    const avgConfidence = memories.reduce((s, m) => s + (m.confidence || 0), 0) / memories.length;
    if (avgConfidence < 0.4) {
      const topFact = memories[0].fact;
      return `Based on low-confidence memory (${(avgConfidence * 100).toFixed(0)}%): ${topFact}. This is uncertain and should not be treated as confirmed.`;
    }

    // Check for probationary/causal memories
    const probationary = memories.filter(m => m._promotionLayer === 'L3_hypothesis');
    if (probationary.length > 0 && probationary.length === memories.length) {
      return `I have unverified hypotheses about this: ${probationary.map(m => `"${m.fact}"`).join('; ')}. These are causal claims still on probation and not yet confirmed.`;
    }

    // Standard answer: use the top-ranked memory
    const topMemories = memories.slice(0, 3);
    if (topMemories.length === 1) {
      return `${topMemories[0].fact}`;
    }

    // Multiple relevant memories: synthesize
    const primary = topMemories[0].fact;
    const supporting = topMemories.slice(1).map(m => m.fact).join('; ');
    return `${primary}. Additional context: ${supporting}`;
  }

  _assessStakes(questionText) {
    const lower = questionText.toLowerCase();
    const highStakes = ['security', 'private', 'production', 'critical', 'risk', 'vulnerability', 'delete'];
    if (highStakes.some(k => lower.includes(k))) return 'high';
    return 'low';
  }

  _assessConfidence(result) {
    if (result.memories.length === 0) return 0;
    const avgConf = result.memories.reduce((s, m) => s + (m.confidence || 0), 0) / result.memories.length;
    const uncertaintyPenalty = (result.metadata?.uncertainty || 0) * 0.3;
    return Math.max(0, Math.min(1, avgConf - uncertaintyPenalty));
  }

  /**
   * Get agent summary stats.
   */
  getSummary() {
    const stored = this.experienceLog.filter(e => e.stored).length;
    const total = this.experienceLog.length;
    const health = this.wdma.health();

    return {
      name: this.name,
      memoriesStored: stored,
      memoriesDropped: total - stored,
      totalExperiences: total,
      encodeRate: total > 0 ? (stored / total * 100).toFixed(1) + '%' : 'N/A',
      stage: health.stage,
      memoryCount: health.memoryCount,
      joltStats: health.joltStats,
      mitigationStats: health.mitigationStats,
    };
  }
}
