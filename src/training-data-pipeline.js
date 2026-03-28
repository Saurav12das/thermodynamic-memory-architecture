/**
 * WDMA Memory-as-Training-Data Pipeline
 *
 * Core insight: Memory is not just a retrieval equation — memory IS training data.
 *
 * Every interaction the agent has (remember, recall, feedback) generates
 * training signal. This module captures that signal and converts it into
 * fine-tuning-ready datasets in multiple formats:
 *
 * 1. **Experience Replay Buffer** — stores (query, retrieved, outcome) triples
 * 2. **Instruction Pairs** — (question, best_answer) for SFT
 * 3. **Preference Pairs** — (question, chosen, rejected) for DPO/RLHF
 * 4. **Curriculum Sequences** — ordered training progressions from D0→D5
 * 5. **Negative Signal** — failed retrievals, contradictions, hallucinations
 *
 * Export formats: JSONL (OpenAI/Anthropic fine-tuning), HuggingFace datasets,
 * raw JSON for custom pipelines.
 *
 * The key differentiator from retrieval-only memory:
 *   - Retrieval memory: "Here's what I know" → answer at inference time
 *   - Training memory: "Here's what I learned" → improve the model itself
 */

export class TrainingDataPipeline {
  constructor(config = {}) {
    // Experience replay buffer
    this._replayBuffer = [];
    this.maxReplaySize = config.maxReplaySize ?? 10000;

    // Interaction log: every recall + outcome
    this._interactions = [];
    this.maxInteractions = config.maxInteractions ?? 50000;

    // Pending feedback: interactions awaiting outcome signal
    this._pendingFeedback = new Map(); // interactionId -> interaction

    // Training data generation config
    this.minConfidenceForPositive = config.minConfidenceForPositive ?? 0.7;
    this.maxConfidenceForNegative = config.maxConfidenceForNegative ?? 0.3;

    // Stats
    this._stats = {
      interactionsLogged: 0,
      feedbackReceived: 0,
      positiveExamples: 0,
      negativeExamples: 0,
      preferencePairs: 0,
      curriculumGenerated: 0,
    };

    this._interactionCounter = 0;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 1: CAPTURE — Log every interaction as potential training data
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Log a recall interaction (query → retrieved memories → answer).
   * This is the raw material for training data.
   *
   * @param {Object} interaction - {
   *   query: string,
   *   retrievedMemories: Array,
   *   answer: string,
   *   tier: string,
   *   confidence: number,
   *   latencyMs: number,
   *   metadata?: Object,
   * }
   * @returns {string} Interaction ID for later feedback attachment
   */
  logInteraction(interaction) {
    const id = `int_${++this._interactionCounter}`;

    const entry = {
      id,
      timestamp: new Date().toISOString(),
      query: interaction.query,
      retrievedFacts: (interaction.retrievedMemories || []).map(m => ({
        fact: m.fact,
        confidence: m.confidence,
        layer: m.layer,
        type: m.type,
        id: m.id,
      })),
      answer: interaction.answer || '',
      tier: interaction.tier || 'R0',
      confidence: interaction.confidence ?? 0.5,
      latencyMs: interaction.latencyMs || 0,
      memoriesUsed: (interaction.retrievedMemories || []).length,
      metadata: interaction.metadata || {},
      // Will be filled in by feedback
      outcome: null, // 'positive' | 'negative' | 'neutral'
      score: null,   // 0-1
      feedbackTimestamp: null,
    };

    this._interactions.push(entry);
    this._pendingFeedback.set(id, entry);
    this._stats.interactionsLogged++;

    // Enforce buffer limits
    if (this._interactions.length > this.maxInteractions) {
      this._interactions.shift();
    }

    return id;
  }

  /**
   * Attach feedback to a logged interaction.
   * This converts raw interaction into labeled training data.
   */
  attachFeedback(interactionId, correct, score = null) {
    const entry = this._pendingFeedback.get(interactionId);
    if (!entry) return false;

    entry.score = score ?? (correct ? 1.0 : 0.0);
    entry.outcome = correct ? 'positive' : 'negative';
    entry.feedbackTimestamp = new Date().toISOString();

    if (correct) {
      this._stats.positiveExamples++;
    } else {
      this._stats.negativeExamples++;
    }

    this._pendingFeedback.delete(interactionId);
    this._stats.feedbackReceived++;

    // Add to replay buffer
    this._addToReplayBuffer(entry);

    return true;
  }

  /**
   * Log a memory consolidation event as training signal.
   * When episodic memories get compressed into semantic ones,
   * that compression itself is a training example.
   */
  logConsolidation(fromMemories, toSummary) {
    const entry = {
      id: `cons_${++this._interactionCounter}`,
      type: 'consolidation',
      timestamp: new Date().toISOString(),
      inputs: fromMemories.map(m => ({ fact: m.fact, confidence: m.confidence, type: m.type })),
      output: { fact: toSummary.fact, confidence: toSummary.confidence },
      outcome: 'positive', // consolidation is always a positive learning signal
      score: 0.8,
    };

    this._interactions.push(entry);
    this._addToReplayBuffer(entry);
  }

  /**
   * Log a contradiction resolution as training signal.
   * How the system resolved conflicts is valuable training data.
   */
  logContradictionResolution(conflicting, resolved, method) {
    const entry = {
      id: `confl_${++this._interactionCounter}`,
      type: 'contradiction_resolution',
      timestamp: new Date().toISOString(),
      conflicting: conflicting.map(m => ({ fact: m.fact, confidence: m.confidence })),
      resolved: { fact: resolved.fact, confidence: resolved.confidence },
      method,
      outcome: 'positive',
      score: 0.7,
    };

    this._interactions.push(entry);
    this._addToReplayBuffer(entry);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 2: TRANSFORM — Convert interactions into training formats
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generate instruction/completion pairs for Supervised Fine-Tuning (SFT).
   *
   * Format: { instruction, input, output }
   * - instruction: system prompt describing the memory-augmented agent
   * - input: the user query + retrieved context
   * - output: the agent's answer (only from positive examples)
   */
  generateSFTData(opts = {}) {
    const minScore = opts.minScore ?? this.minConfidenceForPositive;
    const includeContext = opts.includeContext ?? true;

    const positive = this._interactions.filter(i =>
      i.outcome === 'positive' &&
      (i.score || 0) >= minScore &&
      i.query && i.answer
    );

    return positive.map(interaction => {
      const context = includeContext && interaction.retrievedFacts?.length > 0
        ? interaction.retrievedFacts.map(f => `- ${f.fact} (confidence: ${f.confidence})`).join('\n')
        : '';

      return {
        instruction: 'You are an agent with a structured memory system. Answer the user\'s question using the retrieved memory context. If the context is insufficient, say so. Express appropriate uncertainty for low-confidence memories.',
        input: context
          ? `Memory context:\n${context}\n\nQuestion: ${interaction.query}`
          : `Question: ${interaction.query}`,
        output: interaction.answer,
        metadata: {
          interactionId: interaction.id,
          score: interaction.score,
          tier: interaction.tier,
          memoriesUsed: interaction.memoriesUsed,
          timestamp: interaction.timestamp,
        },
      };
    });
  }

  /**
   * Generate preference pairs for Direct Preference Optimization (DPO/RLHF).
   *
   * Pairs a positive answer (chosen) with a negative answer (rejected)
   * for the same or similar query type.
   *
   * Format: { prompt, chosen, rejected }
   */
  generateDPOData(opts = {}) {
    const positive = this._interactions.filter(i => i.outcome === 'positive' && i.query && i.answer);
    const negative = this._interactions.filter(i => i.outcome === 'negative' && i.query && i.answer);

    const pairs = [];

    for (const pos of positive) {
      // Find a negative example with a similar query (or any negative if none matches)
      const matchingNeg = negative.find(n => this._querySimilarity(pos.query, n.query) > 0.3)
        || negative[0];

      if (!matchingNeg) continue;

      const context = pos.retrievedFacts?.length > 0
        ? pos.retrievedFacts.map(f => `- ${f.fact}`).join('\n')
        : '';

      pairs.push({
        prompt: context
          ? `Memory context:\n${context}\n\nQuestion: ${pos.query}`
          : `Question: ${pos.query}`,
        chosen: pos.answer,
        rejected: matchingNeg.answer,
        metadata: {
          chosenScore: pos.score,
          rejectedScore: matchingNeg.score,
          chosenId: pos.id,
          rejectedId: matchingNeg.id,
        },
      });

      this._stats.preferencePairs++;
    }

    return pairs;
  }

  /**
   * Generate training data specifically from negative signals.
   * Failed retrievals, contradictions, and low-confidence answers
   * are "what not to do" examples.
   *
   * Format: { input, bad_output, correction_hint }
   */
  generateNegativeSignalData() {
    const negative = this._interactions.filter(i =>
      i.outcome === 'negative' && i.query
    );

    return negative.map(interaction => {
      const hints = [];

      // Analyze why it failed
      if (interaction.memoriesUsed === 0) {
        hints.push('No relevant memories were retrieved. The system should acknowledge lack of knowledge.');
      }
      if (interaction.confidence < 0.3) {
        hints.push(`Answer confidence was very low (${interaction.confidence}). Should have expressed more uncertainty.`);
      }
      if (interaction.metadata?.uncertainty > 0.3) {
        hints.push(`High uncertainty (${interaction.metadata.uncertainty}) detected but not surfaced in answer.`);
      }
      if (interaction.metadata?.conflicts?.length > 0) {
        hints.push(`Contradictions existed but were not addressed in the answer.`);
      }

      return {
        input: `Question: ${interaction.query}`,
        bad_output: interaction.answer,
        correction_hint: hints.length > 0 ? hints.join(' ') : 'Answer was incorrect or unhelpful.',
        metadata: {
          interactionId: interaction.id,
          score: interaction.score,
          tier: interaction.tier,
          memoriesUsed: interaction.memoriesUsed,
        },
      };
    });
  }

  /**
   * Generate training data from the memory store itself.
   * Each memory becomes a training example about that fact.
   *
   * This is the purest form of "memory = training data":
   * the knowledge base IS the fine-tuning dataset.
   */
  generateMemoryTrainingData(memories, opts = {}) {
    const minConfidence = opts.minConfidence ?? 0.5;

    const eligible = memories.filter(m =>
      m.fact && (m.confidence || 0) >= minConfidence
    );

    const data = [];

    for (const mem of eligible) {
      // Fact recall training
      data.push({
        type: 'fact_recall',
        instruction: 'Recall the following fact from memory.',
        input: `What do you know about: ${this._extractTopic(mem.fact)}?`,
        output: mem.fact,
        metadata: { memoryId: mem.id, confidence: mem.confidence, layer: mem.layer, type: mem.type },
      });

      // Confidence calibration training
      if (mem.confidence < 0.5) {
        data.push({
          type: 'calibration',
          instruction: 'Express appropriate confidence about this memory.',
          input: `How confident are you about: "${mem.fact}"?`,
          output: `I have low confidence (${(mem.confidence * 100).toFixed(0)}%) about this. It should be treated as uncertain.`,
          metadata: { memoryId: mem.id, confidence: mem.confidence },
        });
      }

      // Temporal awareness training (for superseded memories)
      if (mem.supersedes?.length > 0) {
        data.push({
          type: 'temporal_update',
          instruction: 'This fact supersedes an older version. Explain what changed.',
          input: `What is the current state regarding: ${this._extractTopic(mem.fact)}?`,
          output: `The current information is: ${mem.fact}. This supersedes ${mem.supersedes.length} older record(s).`,
          metadata: { memoryId: mem.id, supersedes: mem.supersedes },
        });
      }

      // Layer-appropriate behavior training
      if (mem.layer === 'culture' && (mem.type === 'risk_policy' || mem.type === 'constraint')) {
        data.push({
          type: 'policy_adherence',
          instruction: 'This is a cultural rule or risk policy. It must always be followed.',
          input: `What is the policy regarding: ${this._extractTopic(mem.fact)}?`,
          output: `Policy (${mem.priority} priority): ${mem.fact}. This is a standing rule that must be respected.`,
          metadata: { memoryId: mem.id, priority: mem.priority },
        });
      }
    }

    return data;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 3: CURRICULUM — Generate ordered training progressions
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generate a training curriculum ordered by difficulty.
   * Mirrors the D0-D5 taxonomy: start with simple recall,
   * progress through temporal, contradiction, abstraction, calibration.
   *
   * This is how the memory system trains its successor:
   * the current agent's experiences become the next agent's textbook.
   */
  generateCurriculum(memories, interactions) {
    this._stats.curriculumGenerated++;

    const stages = [];

    // Stage 1: Basic Fact Recall (D0)
    const factRecall = memories
      .filter(m => m.confidence >= 0.8)
      .map(m => ({
        level: 'D0',
        type: 'recall',
        input: `What do you know about ${this._extractTopic(m.fact)}?`,
        output: m.fact,
        difficulty: 0,
      }));
    stages.push({ name: 'Basic Fact Recall', level: 'D0', examples: factRecall });

    // Stage 2: Temporal Awareness (D1)
    const temporal = memories
      .filter(m => m.supersedes?.length > 0)
      .map(m => ({
        level: 'D1',
        type: 'temporal',
        input: `What is the CURRENT status of: ${this._extractTopic(m.fact)}?`,
        output: `Current: ${m.fact} (supersedes ${m.supersedes.length} older version(s))`,
        difficulty: 1,
      }));
    stages.push({ name: 'Temporal Awareness', level: 'D1', examples: temporal });

    // Stage 3: Confabulation Resistance (D2)
    const confabulation = memories
      .filter(m => m.confidence >= 0.7)
      .slice(0, 20)
      .flatMap(m => {
        const perturbed = this._perturbFact(m.fact);
        return [{
          level: 'D2',
          type: 'confabulation_resistance',
          input: `Is this exactly correct? "${perturbed}"`,
          output: `No, the correct version is: "${m.fact}"`,
          difficulty: 2,
        }];
      });
    stages.push({ name: 'Confabulation Resistance', level: 'D2', examples: confabulation });

    // Stage 4: Contradiction Handling (D3)
    const contradictions = interactions
      .filter(i => i.type === 'contradiction_resolution')
      .map(i => ({
        level: 'D3',
        type: 'contradiction',
        input: `Conflicting information: ${i.conflicting.map(c => `"${c.fact}"`).join(' vs ')}. Which is correct?`,
        output: `Resolved to: "${i.resolved.fact}" via ${i.method}`,
        difficulty: 3,
      }));
    stages.push({ name: 'Contradiction Handling', level: 'D3', examples: contradictions });

    // Stage 5: Abstraction (D4)
    const byType = {};
    for (const m of memories) {
      const t = m.type || 'event';
      if (!byType[t]) byType[t] = [];
      byType[t].push(m);
    }
    const abstraction = Object.entries(byType)
      .filter(([, group]) => group.length >= 3)
      .map(([type, group]) => ({
        level: 'D4',
        type: 'abstraction',
        input: `What patterns exist across ${group.length} "${type}" memories?`,
        output: `Common pattern: ${group.slice(0, 3).map(m => m.fact).join('; ')}`,
        difficulty: 4,
      }));
    stages.push({ name: 'Abstraction & Patterns', level: 'D4', examples: abstraction });

    // Stage 6: Calibration (D5)
    const calibration = [
      ...memories.filter(m => m.confidence < 0.4).map(m => ({
        level: 'D5',
        type: 'low_confidence_calibration',
        input: `How confident are you about: "${m.fact}"?`,
        output: `Low confidence (${(m.confidence * 100).toFixed(0)}%). This is uncertain and should not be treated as confirmed fact.`,
        difficulty: 5,
      })),
      // "I don't know" examples from failed retrievals
      ...interactions
        .filter(i => i.outcome === 'negative' && i.memoriesUsed === 0)
        .map(i => ({
          level: 'D5',
          type: 'unknown_calibration',
          input: i.query,
          output: 'I have no relevant memory about this topic. I cannot provide a confident answer.',
          difficulty: 5,
        })),
    ];
    stages.push({ name: 'Calibration & Uncertainty', level: 'D5', examples: calibration });

    return {
      stages,
      totalExamples: stages.reduce((sum, s) => sum + s.examples.length, 0),
      byLevel: Object.fromEntries(stages.map(s => [s.level, s.examples.length])),
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Phase 4: EXPORT — Output in standard fine-tuning formats
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Export as OpenAI-style fine-tuning JSONL.
   * Format: { messages: [{ role, content }] }
   */
  exportOpenAIFormat(data) {
    return data.map(example => {
      const messages = [
        { role: 'system', content: example.instruction || 'You are a memory-augmented agent.' },
        { role: 'user', content: example.input },
        { role: 'assistant', content: example.output },
      ];
      return JSON.stringify({ messages });
    }).join('\n') + '\n';
  }

  /**
   * Export as Anthropic-style fine-tuning JSONL.
   * Format: { prompt, completion }
   */
  exportAnthropicFormat(data) {
    return data.map(example => {
      const prompt = example.instruction
        ? `${example.instruction}\n\nHuman: ${example.input}\n\nAssistant:`
        : `Human: ${example.input}\n\nAssistant:`;
      return JSON.stringify({ prompt, completion: ` ${example.output}` });
    }).join('\n') + '\n';
  }

  /**
   * Export as DPO preference format JSONL.
   * Format: { prompt, chosen, rejected }
   */
  exportDPOFormat(pairs) {
    return pairs.map(p => JSON.stringify({
      prompt: p.prompt,
      chosen: p.chosen,
      rejected: p.rejected,
    })).join('\n') + '\n';
  }

  /**
   * Export curriculum as a staged JSONL with difficulty ordering.
   */
  exportCurriculumFormat(curriculum) {
    const lines = [];
    for (const stage of curriculum.stages) {
      for (const example of stage.examples) {
        lines.push(JSON.stringify({
          level: example.level,
          difficulty: example.difficulty,
          type: example.type,
          input: example.input,
          output: example.output,
          stage: stage.name,
        }));
      }
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Generate a complete training data package from all available signals.
   */
  generateFullPackage(memories) {
    const sft = this.generateSFTData();
    const dpo = this.generateDPOData();
    const negative = this.generateNegativeSignalData();
    const memoryData = this.generateMemoryTrainingData(memories);
    const curriculum = this.generateCurriculum(memories, this._interactions);

    return {
      sft: { count: sft.length, data: sft },
      dpo: { count: dpo.length, data: dpo },
      negative: { count: negative.length, data: negative },
      memoryBased: { count: memoryData.length, data: memoryData },
      curriculum,
      totals: {
        sftExamples: sft.length,
        dpoExamples: dpo.length,
        negativeExamples: negative.length,
        memoryExamples: memoryData.length,
        curriculumExamples: curriculum.totalExamples,
        total: sft.length + dpo.length + negative.length + memoryData.length + curriculum.totalExamples,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Replay Buffer
  // ═══════════════════════════════════════════════════════════════════

  _addToReplayBuffer(entry) {
    this._replayBuffer.push(entry);
    if (this._replayBuffer.length > this.maxReplaySize) {
      this._replayBuffer.shift();
    }
  }

  /**
   * Sample from the replay buffer (uniform or prioritized).
   */
  sampleReplay(n, opts = {}) {
    const pool = opts.positiveOnly
      ? this._replayBuffer.filter(e => e.outcome === 'positive')
      : this._replayBuffer;

    if (pool.length === 0) return [];

    const sampled = [];
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      sampled.push(pool[idx]);
    }
    return sampled;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  _extractTopic(fact) {
    const words = fact.split(/\s+/).filter(w => w.length > 2).slice(0, 6);
    return words.join(' ');
  }

  _querySimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let hits = 0;
    for (const w of wordsA) { if (wordsB.has(w)) hits++; }
    return hits / Math.max(wordsA.size, wordsB.size);
  }

  _perturbFact(fact) {
    const swaps = {
      'weekly': 'monthly', 'daily': 'weekly', 'two': 'three', 'first': 'last',
      'always': 'sometimes', 'never': 'rarely', 'yes': 'no', 'not': '',
    };
    for (const [from, to] of Object.entries(swaps)) {
      if (fact.toLowerCase().includes(from)) {
        return fact.replace(new RegExp(from, 'i'), to);
      }
    }
    // Fallback: append qualifier
    return fact + ' (approximately)';
  }

  /** Get pipeline statistics */
  get stats() {
    return {
      ...this._stats,
      replayBufferSize: this._replayBuffer.length,
      totalInteractions: this._interactions.length,
      pendingFeedback: this._pendingFeedback.size,
      labeledRatio: this._stats.interactionsLogged > 0
        ? ((this._stats.feedbackReceived / this._stats.interactionsLogged) * 100).toFixed(1) + '%'
        : '0%',
    };
  }
}
