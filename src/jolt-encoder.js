/**
 * WDMA Jolt-Based Encoding
 *
 * Models memory encoding as a function of prediction error ("jolt").
 * A memory is written only when the incoming information sufficiently
 * surprises the system relative to its current knowledge.
 *
 * Key insight from the paper: the encoding threshold rises with domain
 * experience, introducing developmental behavior directly into the
 * architecture rather than only into training.
 *
 * Jolt(e) = |observed(e) - predicted(e)|
 *
 * Dynamic threshold:
 *   θ(d) = θ_base + θ_growth · log(1 + experience(d))
 *
 * Encoding decision:
 *   encode(e) = Jolt(e) > θ(domain(e))
 *
 * This replaces the naive "save everything" approach with a principled
 * answer to "why should this memory be written at all?"
 */

const DEFAULT_BASE_THRESHOLD = 0.2;
const DEFAULT_GROWTH_RATE = 0.08;
const DEFAULT_MAX_THRESHOLD = 0.85;

export class JoltEncoder {
  constructor(config = {}) {
    this.baseThreshold = config.baseThreshold ?? DEFAULT_BASE_THRESHOLD;
    this.growthRate = config.growthRate ?? DEFAULT_GROWTH_RATE;
    this.maxThreshold = config.maxThreshold ?? DEFAULT_MAX_THRESHOLD;

    // Domain experience counters: domain -> { count, recentJolts[] }
    this._domainExperience = new Map();

    // Optional: custom prediction function for computing expected value
    // Signature: (event, domainHistory) => { predicted: string, confidence: number }
    this.predictFn = config.predictFn || null;

    this._stats = { evaluated: 0, encoded: 0, suppressed: 0 };
  }

  /**
   * Compute the jolt (prediction error) for an incoming event.
   *
   * @param {Object} event - Incoming event with { fact, domain?, tags?, confidence? }
   * @param {Array} existingMemories - Current memories in the relevant domain
   * @returns {{ jolt: number, threshold: number, encode: boolean, components: Object }}
   */
  evaluate(event, existingMemories = []) {
    this._stats.evaluated++;

    const domain = this._inferDomain(event);
    const experience = this._getExperience(domain);

    // Compute dynamic threshold: rises with domain experience
    const threshold = this._computeThreshold(experience.count);

    // Compute jolt (prediction error)
    const jolt = this._computeJolt(event, existingMemories, experience);

    // Encoding decision
    const shouldEncode = jolt > threshold;

    if (shouldEncode) {
      this._stats.encoded++;
    } else {
      this._stats.suppressed++;
    }

    // Update domain experience
    this._recordExperience(domain, jolt, shouldEncode);

    return {
      jolt: Number(jolt.toFixed(4)),
      threshold: Number(threshold.toFixed(4)),
      encode: shouldEncode,
      domain,
      components: {
        novelty: this._noveltyScore(event, existingMemories),
        contradictionSignal: this._contradictionSignal(event, existingMemories),
        informationGain: this._informationGain(event, existingMemories),
        domainExperience: experience.count,
        baseThreshold: this.baseThreshold,
        effectiveThreshold: Number(threshold.toFixed(4)),
      },
    };
  }

  /**
   * Get the current encoding threshold for a domain.
   */
  getThreshold(domain) {
    const experience = this._getExperience(domain);
    return this._computeThreshold(experience.count);
  }

  /**
   * Dynamic threshold formula:
   * θ(d) = min(θ_base + θ_growth · log(1 + experience(d)), θ_max)
   *
   * As the system gains experience in a domain, it requires higher
   * prediction error to encode new memories — it becomes harder to surprise.
   */
  _computeThreshold(experienceCount) {
    const raw = this.baseThreshold + this.growthRate * Math.log(1 + experienceCount);
    return Math.min(raw, this.maxThreshold);
  }

  /**
   * Compute jolt as a composite of three prediction error signals:
   * 1. Novelty: how different is this from existing memories?
   * 2. Contradiction: does this conflict with established facts?
   * 3. Information gain: how much new information does this add?
   *
   * Jolt = w1·novelty + w2·contradiction + w3·infoGain
   */
  _computeJolt(event, existingMemories, experience) {
    // If custom prediction function is provided, use it
    if (this.predictFn) {
      const prediction = this.predictFn(event, experience.recentJolts);
      if (prediction && typeof prediction.confidence === 'number') {
        // Jolt = 1 - prediction confidence (high confidence = low surprise)
        return 1 - prediction.confidence;
      }
    }

    // Default: composite of novelty, contradiction, and information gain
    const novelty = this._noveltyScore(event, existingMemories);
    const contradiction = this._contradictionSignal(event, existingMemories);
    const infoGain = this._informationGain(event, existingMemories);

    // Contradiction gets highest weight: contradicting established facts
    // is the strongest signal that something important changed
    return 0.35 * novelty + 0.40 * contradiction + 0.25 * infoGain;
  }

  /**
   * Novelty: 1 - max_similarity(event, existing)
   * High when the event doesn't match anything we know.
   */
  _noveltyScore(event, existingMemories) {
    if (existingMemories.length === 0) return 1.0;

    const eventWords = this._tokenize(event.fact || event.text || event.content || '');
    if (eventWords.size === 0) return 1.0;

    let maxSim = 0;
    for (const mem of existingMemories) {
      const memWords = this._tokenize(mem.fact || '');
      const sim = this._jaccardSimilarity(eventWords, memWords);
      if (sim > maxSim) maxSim = sim;
    }

    return 1 - maxSim;
  }

  /**
   * Contradiction signal: detects when event conflicts with existing memories.
   * Returns 1.0 for clear contradictions, 0.0 for no conflict.
   */
  _contradictionSignal(event, existingMemories) {
    if (existingMemories.length === 0) return 0;

    const eventFact = (event.fact || event.text || event.content || '').toLowerCase();
    const negationPatterns = ['not ', 'no longer', 'never ', 'stopped ', 'instead ', 'changed to', 'updated to', 'no more'];

    let contradictionScore = 0;

    for (const mem of existingMemories) {
      const memFact = (mem.fact || '').toLowerCase();

      // Check if event explicitly supersedes
      if (event.supersedes?.includes(mem.id)) {
        contradictionScore = Math.max(contradictionScore, 0.9);
        continue;
      }

      // Check for negation patterns against similar facts
      const similarity = this._jaccardSimilarity(
        this._tokenize(eventFact),
        this._tokenize(memFact)
      );

      if (similarity > 0.3) {
        // Similar topics — check for negation/update language
        for (const pattern of negationPatterns) {
          if (eventFact.includes(pattern)) {
            contradictionScore = Math.max(contradictionScore, 0.7 + similarity * 0.3);
            break;
          }
        }

        // Same type + same domain but different fact = potential contradiction
        if (event.type === mem.type && similarity > 0.5 && similarity < 0.95) {
          contradictionScore = Math.max(contradictionScore, 0.5);
        }
      }
    }

    return Math.min(contradictionScore, 1.0);
  }

  /**
   * Information gain: how much new content does this event add?
   * Based on unique tokens not found in existing memories.
   */
  _informationGain(event, existingMemories) {
    const eventWords = this._tokenize(event.fact || event.text || event.content || '');
    if (eventWords.size === 0) return 0;

    if (existingMemories.length === 0) return 1.0;

    // Collect all known tokens
    const knownTokens = new Set();
    for (const mem of existingMemories) {
      for (const w of this._tokenize(mem.fact || '')) {
        knownTokens.add(w);
      }
    }

    // Count new tokens
    let newTokens = 0;
    for (const w of eventWords) {
      if (!knownTokens.has(w)) newTokens++;
    }

    return newTokens / eventWords.size;
  }

  // ── Domain Experience Tracking ────────────────────────────────────

  _inferDomain(event) {
    // Use explicit domain, first tag, type, or 'general'
    return event.domain || (event.tags && event.tags[0]) || event.type || 'general';
  }

  _getExperience(domain) {
    if (!this._domainExperience.has(domain)) {
      this._domainExperience.set(domain, { count: 0, recentJolts: [] });
    }
    return this._domainExperience.get(domain);
  }

  _recordExperience(domain, jolt, wasEncoded) {
    const exp = this._getExperience(domain);
    exp.count++;
    exp.recentJolts.push({ jolt, encoded: wasEncoded, time: Date.now() });
    // Keep rolling window of last 50 jolts
    if (exp.recentJolts.length > 50) exp.recentJolts.shift();
  }

  // ── Utilities ─────────────────────────────────────────────────────

  _tokenize(text) {
    return new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  }

  _jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 1;
    if (setA.size === 0 || setB.size === 0) return 0;
    let intersection = 0;
    for (const w of setA) {
      if (setB.has(w)) intersection++;
    }
    return intersection / (setA.size + setB.size - intersection);
  }

  /** Get encoding statistics */
  get stats() {
    return {
      ...this._stats,
      domainCount: this._domainExperience.size,
      domains: Object.fromEntries(
        [...this._domainExperience].map(([k, v]) => [k, {
          experience: v.count,
          threshold: Number(this._computeThreshold(v.count).toFixed(4)),
          recentEncodeRate: v.recentJolts.length > 0
            ? v.recentJolts.filter(j => j.encoded).length / v.recentJolts.length
            : 0,
        }])
      ),
    };
  }
}
