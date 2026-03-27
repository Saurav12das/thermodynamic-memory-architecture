/**
 * WDMA D0–D5 Synthetic Expansion Taxonomy
 *
 * Benchmark data generator implementing the six-level evaluation axis:
 *
 *   D0: Raw Recall — can the system retrieve what was stored?
 *   D1: Temporal Ordering — can it resolve "which came first/last"?
 *   D2: One-Knob Perturbation — near-miss confabulation challenges
 *   D3: Contradiction Detection & Repair — conflicting facts, explicit resolution
 *   D4: Abstraction & Generalization — pattern extraction from episodic memories
 *   D5: Calibration Signals — confidence accuracy, false-certainty detection
 *
 * Per reviewer: "D0-D5 may be the most publishable component because it is
 * modular, understandable, and testable." This module generates benchmark
 * cases at each difficulty level from a seed memory set.
 */

import crypto from 'node:crypto';

export class D0D5Benchmark {
  constructor(config = {}) {
    this.seed = config.seed || Date.now();
    this._rng = this._createRng(this.seed);
  }

  /**
   * Generate a full benchmark suite from a set of seed memories.
   *
   * @param {Array} seedMemories - Array of memory records to generate from
   * @param {Object} opts - { casesPerLevel?: number, levels?: string[] }
   * @returns {{ cases: Array, metadata: Object }}
   */
  generate(seedMemories, opts = {}) {
    const casesPerLevel = opts.casesPerLevel ?? 5;
    const levels = opts.levels ?? ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];

    const allCases = [];

    for (const level of levels) {
      const generator = this._generators[level];
      if (!generator) continue;

      const cases = generator.call(this, seedMemories, casesPerLevel);
      allCases.push(...cases);
    }

    return {
      cases: allCases,
      metadata: {
        totalCases: allCases.length,
        byLevel: Object.fromEntries(levels.map(l => [l, allCases.filter(c => c.level === l).length])),
        seedCount: seedMemories.length,
        generatedAt: new Date().toISOString(),
        seed: this.seed,
      },
    };
  }

  /**
   * Export benchmark as JSONL (one case per line) for eval runner.
   */
  toJsonl(cases) {
    return cases.map(c => JSON.stringify(c)).join('\n') + '\n';
  }

  // ── Level Generators ──────────────────────────────────────────────

  get _generators() {
    return {
      D0: this._generateD0,
      D1: this._generateD1,
      D2: this._generateD2,
      D3: this._generateD3,
      D4: this._generateD4,
      D5: this._generateD5,
    };
  }

  /**
   * D0: Raw Recall
   * Can the system retrieve exactly what was stored?
   * Tests: direct fact retrieval, exact match
   */
  _generateD0(memories, count) {
    const cases = [];
    const selected = this._sample(memories, count);

    for (const mem of selected) {
      cases.push({
        id: `d0_${this._uid()}`,
        level: 'D0',
        track: 'recall',
        question: `What was stored about: "${this._extractTopic(mem.fact)}"?`,
        answerType: 'contains',
        ground_truth: mem.fact,
        sourceMemoryId: mem.id,
        difficulty: 'basic',
        rubric: {
          good: this._extractKeyPhrases(mem.fact),
          bad: [],
        },
      });
    }

    return cases;
  }

  /**
   * D1: Temporal Ordering
   * Can the system resolve temporal relationships?
   * Tests: "which came first", "what is the latest", sequence reconstruction
   */
  _generateD1(memories, count) {
    const cases = [];
    const dated = memories.filter(m => m.time?.valid_from).sort(
      (a, b) => (a.time.valid_from || '').localeCompare(b.time.valid_from || '')
    );

    if (dated.length < 2) return cases;

    for (let i = 0; i < Math.min(count, dated.length - 1); i++) {
      const earlier = dated[i];
      const later = dated[Math.min(i + 1, dated.length - 1)];

      // "Which came first?" question
      cases.push({
        id: `d1_order_${this._uid()}`,
        level: 'D1',
        track: 'temporal',
        question: `Which happened first: "${this._shorten(earlier.fact)}" or "${this._shorten(later.fact)}"?`,
        answerType: 'contains',
        ground_truth: this._shorten(earlier.fact),
        sourceMemoryIds: [earlier.id, later.id],
        difficulty: 'temporal',
      });

      // "What is the most recent?" question
      if (i === dated.length - 2) {
        cases.push({
          id: `d1_latest_${this._uid()}`,
          level: 'D1',
          track: 'temporal',
          question: `What is the most recent fact recorded?`,
          answerType: 'contains',
          ground_truth: later.fact,
          sourceMemoryIds: [later.id],
          difficulty: 'temporal',
        });
      }
    }

    return cases.slice(0, count);
  }

  /**
   * D2: One-Knob Perturbation (Near-Miss Confabulation)
   * Can the system distinguish stored facts from plausible-but-wrong variations?
   * Tests: slightly altered facts, number perturbations, entity swaps
   *
   * This is "the smart way to create near-miss confabulation challenges" (reviewer).
   */
  _generateD2(memories, count) {
    const cases = [];
    const selected = this._sample(memories, count);

    for (const mem of selected) {
      const perturbation = this._perturbFact(mem.fact);

      cases.push({
        id: `d2_${this._uid()}`,
        level: 'D2',
        track: 'confabulation',
        question: `Is this exactly correct? "${perturbation.altered}"`,
        answerType: 'rubric',
        ground_truth: mem.fact,
        perturbation: {
          original: mem.fact,
          altered: perturbation.altered,
          method: perturbation.method,
          diff: perturbation.diff,
        },
        rubric: {
          good: ['no', 'incorrect', 'not exactly', 'wrong', 'actually', 'original', ...this._extractKeyPhrases(mem.fact)],
          bad: ['yes', 'correct', 'exactly right'],
        },
        sourceMemoryId: mem.id,
        difficulty: 'confabulation',
      });
    }

    return cases;
  }

  /**
   * D3: Contradiction Detection & Repair
   * Can the system detect and resolve conflicting information?
   * Tests: superseded facts, concurrent contradictions, resolution
   */
  _generateD3(memories, count) {
    const cases = [];

    // Find supersession chains
    const superseded = memories.filter(m => m.supersedes?.length > 0);
    for (const child of superseded.slice(0, Math.ceil(count / 2))) {
      for (const parentId of child.supersedes) {
        const parent = memories.find(m => m.id === parentId);
        if (parent) {
          cases.push({
            id: `d3_supersede_${this._uid()}`,
            level: 'D3',
            track: 'contradiction',
            question: `"${this._shorten(parent.fact)}" was recorded, but later "${this._shorten(child.fact)}" was recorded as superseding it. Which is current?`,
            answerType: 'contains',
            ground_truth: child.fact,
            sourceMemoryIds: [parent.id, child.id],
            difficulty: 'contradiction',
          });
        }
      }
    }

    // Generate synthetic contradictions from existing memories
    const eligible = memories.filter(m => m.fact && m.fact.length > 20);
    for (let i = cases.length; i < count && eligible.length > 0; i++) {
      const mem = eligible[i % eligible.length];
      const contradicted = this._generateContradiction(mem.fact);

      cases.push({
        id: `d3_synthetic_${this._uid()}`,
        level: 'D3',
        track: 'contradiction',
        question: `Two conflicting memories exist: (A) "${this._shorten(mem.fact)}" and (B) "${this._shorten(contradicted)}". If (A) was stored first and (B) is not verified, which should be preferred?`,
        answerType: 'rubric',
        ground_truth: mem.fact,
        rubric: {
          good: ['A', 'first', 'original', 'verified', ...this._extractKeyPhrases(mem.fact)],
          bad: ['B', 'second', 'unverified'],
        },
        sourceMemoryId: mem.id,
        difficulty: 'contradiction',
      });
    }

    return cases.slice(0, count);
  }

  /**
   * D4: Abstraction & Generalization
   * Can the system extract patterns from multiple episodic memories?
   * Tests: pattern recognition, rule extraction, summary generation
   */
  _generateD4(memories, count) {
    const cases = [];

    // Group memories by type
    const byType = {};
    for (const m of memories) {
      const t = m.type || 'event';
      if (!byType[t]) byType[t] = [];
      byType[t].push(m);
    }

    for (const [type, group] of Object.entries(byType)) {
      if (group.length < 2) continue;

      // Pattern recognition question
      cases.push({
        id: `d4_pattern_${this._uid()}`,
        level: 'D4',
        track: 'abstraction',
        question: `Given ${group.length} "${type}" memories, what common pattern or rule can be extracted?`,
        answerType: 'rubric',
        ground_truth: `Pattern across ${group.length} ${type} memories`,
        rubric: {
          good: ['pattern', 'common', 'rule', 'always', 'typically', type],
          bad: ['specific', 'one time', 'no pattern'],
        },
        sourceMemoryIds: group.map(m => m.id),
        difficulty: 'abstraction',
        context: group.map(m => ({ id: m.id, fact: m.fact })),
      });

      if (cases.length >= count) break;
    }

    // Tag-based pattern detection
    const byTag = {};
    for (const m of memories) {
      for (const tag of (m.tags || [])) {
        if (!byTag[tag]) byTag[tag] = [];
        byTag[tag].push(m);
      }
    }

    for (const [tag, group] of Object.entries(byTag)) {
      if (group.length < 2 || cases.length >= count) continue;

      cases.push({
        id: `d4_tag_${this._uid()}`,
        level: 'D4',
        track: 'abstraction',
        question: `What can be generalized from memories tagged "${tag}"?`,
        answerType: 'rubric',
        ground_truth: `Generalization from ${group.length} "${tag}" memories`,
        rubric: {
          good: [tag, 'general', 'pattern', 'summary'],
          bad: [],
        },
        sourceMemoryIds: group.map(m => m.id),
        difficulty: 'abstraction',
      });
    }

    return cases.slice(0, count);
  }

  /**
   * D5: Calibration Signals
   * Can the system accurately represent its own confidence?
   * Tests: "I don't know" detection, confidence accuracy, false-certainty
   *
   * "D5 directly addresses the false-certainty problem that many memory
   * systems quietly suffer from" (reviewer).
   */
  _generateD5(memories, count) {
    const cases = [];

    // Test 1: Ask about something NOT in memory — should express uncertainty
    const nonExistentTopics = [
      'quantum entanglement in database sharding',
      'the Mars colony deployment schedule for 2030',
      'underwater basket weaving certification requirements',
      'recursive pizza delivery optimization algorithm',
      'chromatic aberration in blockchain consensus',
    ];

    for (let i = 0; i < Math.min(Math.ceil(count / 2), nonExistentTopics.length); i++) {
      cases.push({
        id: `d5_unknown_${this._uid()}`,
        level: 'D5',
        track: 'calibration',
        question: `What do you know about "${nonExistentTopics[i]}"?`,
        answerType: 'rubric',
        ground_truth: 'No relevant memory exists',
        rubric: {
          good: ['don\'t know', 'no information', 'no memory', 'uncertain', 'not found', 'no relevant', 'cannot recall'],
          bad: ['here is', 'the answer', 'I know that', 'according to'],
        },
        difficulty: 'calibration',
        expectedConfidence: 'low',
      });
    }

    // Test 2: Ask about low-confidence memories — should surface uncertainty
    const lowConfidence = memories.filter(m => (m.confidence || 0) < 0.5);
    for (const mem of lowConfidence.slice(0, Math.floor(count / 2))) {
      cases.push({
        id: `d5_lowconf_${this._uid()}`,
        level: 'D5',
        track: 'calibration',
        question: `How confident are you about: "${this._shorten(mem.fact)}"?`,
        answerType: 'rubric',
        ground_truth: `Low confidence (${mem.confidence})`,
        rubric: {
          good: ['low', 'uncertain', 'not sure', 'limited', 'might', 'possibly', `${Math.round((mem.confidence || 0) * 100)}%`],
          bad: ['certain', 'definitely', 'absolutely', 'high confidence'],
        },
        sourceMemoryId: mem.id,
        difficulty: 'calibration',
        expectedConfidence: 'low',
      });
    }

    return cases.slice(0, count);
  }

  // ── Perturbation Methods ──────────────────────────────────────────

  _perturbFact(fact) {
    const methods = [
      this._perturbNumbers,
      this._perturbEntity,
      this._perturbNegation,
      this._perturbQuantifier,
    ];

    // Try each method until one produces a change
    for (const method of this._shuffle(methods)) {
      const result = method.call(this, fact);
      if (result.altered !== fact) return result;
    }

    // Fallback: swap two words
    const words = fact.split(' ');
    if (words.length >= 4) {
      const i = 1 + Math.floor(this._random() * (words.length - 2));
      [words[i], words[i + 1]] = [words[i + 1], words[i]];
      return { altered: words.join(' '), method: 'word_swap', diff: `swapped positions ${i} and ${i + 1}` };
    }

    return { altered: fact + ' (approximately)', method: 'qualifier_append', diff: 'added qualifier' };
  }

  _perturbNumbers(fact) {
    const match = fact.match(/\d+/);
    if (!match) return { altered: fact, method: 'none', diff: '' };
    const num = parseInt(match[0]);
    const delta = Math.max(1, Math.floor(num * 0.2));
    const newNum = this._random() > 0.5 ? num + delta : Math.max(1, num - delta);
    return {
      altered: fact.replace(match[0], String(newNum)),
      method: 'number_perturbation',
      diff: `${match[0]} → ${newNum}`,
    };
  }

  _perturbEntity(fact) {
    const swaps = {
      'weekly': 'monthly', 'monthly': 'weekly', 'daily': 'weekly',
      'Tuesday': 'Thursday', 'Monday': 'Wednesday', 'Friday': 'Monday',
      'production': 'staging', 'staging': 'production',
      'dark': 'light', 'light': 'dark',
      'yes': 'no', 'no': 'yes',
      'first': 'last', 'last': 'first',
    };

    for (const [from, to] of Object.entries(swaps)) {
      if (fact.includes(from)) {
        return {
          altered: fact.replace(from, to),
          method: 'entity_swap',
          diff: `${from} → ${to}`,
        };
      }
    }

    return { altered: fact, method: 'none', diff: '' };
  }

  _perturbNegation(fact) {
    if (fact.includes(' not ')) {
      return { altered: fact.replace(' not ', ' '), method: 'negation_removal', diff: 'removed "not"' };
    }
    if (fact.includes(' should ')) {
      return { altered: fact.replace(' should ', ' should not '), method: 'negation_insertion', diff: 'inserted "not"' };
    }
    if (fact.includes(' is ')) {
      return { altered: fact.replace(' is ', ' is not '), method: 'negation_insertion', diff: 'inserted "not"' };
    }
    return { altered: fact, method: 'none', diff: '' };
  }

  _perturbQuantifier(fact) {
    const swaps = {
      'always': 'sometimes', 'sometimes': 'always',
      'all': 'some', 'some': 'all',
      'never': 'rarely', 'rarely': 'never',
      'at least': 'at most', 'at most': 'at least',
    };

    for (const [from, to] of Object.entries(swaps)) {
      if (fact.toLowerCase().includes(from)) {
        const regex = new RegExp(from, 'i');
        return { altered: fact.replace(regex, to), method: 'quantifier_swap', diff: `${from} → ${to}` };
      }
    }

    return { altered: fact, method: 'none', diff: '' };
  }

  _generateContradiction(fact) {
    const result = this._perturbNegation(fact);
    if (result.altered !== fact) return result.altered;
    const entityResult = this._perturbEntity(fact);
    if (entityResult.altered !== fact) return entityResult.altered;
    return 'The opposite of: ' + fact;
  }

  // ── Utilities ─────────────────────────────────────────────────────

  _uid() {
    return crypto.randomBytes(4).toString('hex');
  }

  _extractTopic(fact) {
    // Take first 6 significant words
    const words = fact.split(/\s+/).filter(w => w.length > 2).slice(0, 6);
    return words.join(' ');
  }

  _extractKeyPhrases(fact) {
    // Extract 3-5 word segments as key phrases
    const words = fact.split(/\s+/).filter(w => w.length > 2);
    if (words.length <= 3) return words;
    return [words.slice(0, 3).join(' '), words.slice(-3).join(' ')];
  }

  _shorten(text, maxLen = 60) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - 3) + '...';
  }

  _sample(arr, n) {
    const shuffled = [...arr];
    this._shuffleInPlace(shuffled);
    return shuffled.slice(0, Math.min(n, shuffled.length));
  }

  _shuffle(arr) {
    const copy = [...arr];
    this._shuffleInPlace(copy);
    return copy;
  }

  _shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // Simple seeded RNG (xorshift32)
  _createRng(seed) {
    let state = seed | 0 || 1;
    return () => {
      state ^= state << 13;
      state ^= state >> 17;
      state ^= state << 5;
      return (state >>> 0) / 4294967296;
    };
  }

  _random() {
    return this._rng();
  }
}
