/**
 * WDMA Conflict Resolver
 * Implements the conflict policy from the spec:
 * 1. Prefer latest valid fact if supersession chain exists
 * 2. If unresolved conflict, surface uncertainty
 * 3. Never fabricate resolution
 * 4. Preserve audit trail of prior states
 */

export class ConflictResolver {
  constructor(store, config = {}) {
    this.store = store;
    this.uncertaintyThreshold = config.uncertaintyThreshold ?? 0.3;
    this._auditLog = [];
  }

  /**
   * Resolve conflicts among a set of candidate memories for a query.
   *
   * @param {Array} memories - Candidate memory records
   * @returns {{ resolved: Array, conflicts: Array, uncertainty: number, auditEntries: Array }}
   */
  resolve(memories) {
    if (memories.length <= 1) {
      return { resolved: memories, conflicts: [], uncertainty: 0, auditEntries: [] };
    }

    const auditEntries = [];
    const conflicts = [];
    const resolved = [];

    // Group by supersession chains
    const chains = this._buildChains(memories);

    for (const chain of chains) {
      if (chain.length === 1) {
        resolved.push(chain[0]);
        continue;
      }

      // Sort chain by valid_from descending (newest first)
      chain.sort((a, b) =>
        (b.time?.valid_from || '').localeCompare(a.time?.valid_from || '')
      );

      const latest = chain[0];
      const older = chain.slice(1);

      // Policy 1: Prefer latest valid fact
      resolved.push(latest);

      // Policy 4: Preserve audit trail
      for (const old of older) {
        const entry = {
          action: 'superseded',
          keptId: latest.id,
          supersededId: old.id,
          keptFact: latest.fact,
          supersededFact: old.fact,
          timestamp: new Date().toISOString(),
        };
        auditEntries.push(entry);
        this._auditLog.push(entry);
      }

      // Record the conflict
      conflicts.push({
        chainIds: chain.map(m => m.id),
        resolvedTo: latest.id,
        method: 'prefer_latest',
      });
    }

    // Check for unresolved contradictions (same topic, no supersession link)
    const unlinked = this._detectUnlinkedContradictions(resolved);
    for (const pair of unlinked) {
      conflicts.push({
        ids: [pair[0].id, pair[1].id],
        resolvedTo: null,
        method: 'unresolved_surface_uncertainty',
      });
    }

    // Policy 2: Calculate overall uncertainty
    const uncertainty = conflicts.length > 0
      ? Math.min(conflicts.filter(c => !c.resolvedTo).length / Math.max(memories.length, 1), 1.0)
      : 0;

    return { resolved, conflicts, uncertainty, auditEntries };
  }

  /**
   * Check if a new memory contradicts existing ones and return resolution advice.
   */
  checkIncoming(newRecord, existingMemories) {
    const potentialConflicts = existingMemories.filter(m =>
      m.layer === newRecord.layer &&
      m.type === newRecord.type &&
      m.id !== newRecord.id &&
      !m.time?.valid_to // still valid
    );

    if (potentialConflicts.length === 0) {
      return { hasConflict: false, action: 'store', conflictsWith: [] };
    }

    // If the new record explicitly supersedes, it's a clean update
    if (newRecord.supersedes?.length > 0) {
      return {
        hasConflict: true,
        action: 'supersede',
        conflictsWith: potentialConflicts.filter(m => newRecord.supersedes.includes(m.id)),
      };
    }

    // Otherwise, flag for manual resolution
    return {
      hasConflict: true,
      action: 'flag_uncertainty',
      conflictsWith: potentialConflicts,
      suggestion: 'Add supersedes field to explicitly resolve, or store with lower confidence.',
    };
  }

  /** Get the full audit log */
  get auditLog() {
    return [...this._auditLog];
  }

  // ── Internal Helpers ──────────────────────────────────────────────

  /** Build supersession chains from a flat list of memories */
  _buildChains(memories) {
    const byId = new Map(memories.map(m => [m.id, m]));
    const visited = new Set();
    const chains = [];

    for (const m of memories) {
      if (visited.has(m.id)) continue;

      const chain = [m];
      visited.add(m.id);

      // Walk backwards through supersedes
      const queue = [...(m.supersedes || [])];
      while (queue.length > 0) {
        const parentId = queue.shift();
        if (visited.has(parentId)) continue;
        const parent = byId.get(parentId);
        if (parent) {
          chain.push(parent);
          visited.add(parentId);
          queue.push(...(parent.supersedes || []));
        }
      }

      // Walk forwards: find records that supersede members of this chain
      for (const other of memories) {
        if (visited.has(other.id)) continue;
        if (other.supersedes?.some(sid => chain.find(c => c.id === sid))) {
          chain.push(other);
          visited.add(other.id);
        }
      }

      chains.push(chain);
    }

    return chains;
  }

  /** Detect potential contradictions between unlinked memories */
  _detectUnlinkedContradictions(memories) {
    const pairs = [];
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i];
        const b = memories[j];
        // Same layer + type but different facts with no supersession link
        if (a.layer === b.layer && a.type === b.type &&
            a.fact !== b.fact &&
            !a.supersedes?.includes(b.id) &&
            !b.supersedes?.includes(a.id)) {
          // Only flag if facts are about the same topic (high word overlap)
          // but say different things (not identical)
          const similarity = this._factSimilarity(a.fact, b.fact);
          if (similarity > 0.35 && similarity < 0.9) {
            pairs.push([a, b]);
          }
        }
      }
    }
    return pairs;
  }

  /** Jaccard similarity between two facts based on word overlap */
  _factSimilarity(factA, factB) {
    const wordsA = new Set(factA.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(factB.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) intersection++;
    }
    return intersection / (wordsA.size + wordsB.size - intersection);
  }
}
