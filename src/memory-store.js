/**
 * WDMA Memory Store
 * Manages structured memory records across layers (past, present, culture, future_seed).
 * Supports file-backed persistence and in-memory operation.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class MemoryStore {
  constructor(config = {}) {
    this.records = new Map();
    this.persistPath = config.persistPath || null;
    this.maxRecords = config.maxRecords || 10000;
    this._supersessionIndex = new Map(); // child -> parent chain
    this._layerIndex = new Map();        // layer -> Set<id>
    this._tagIndex = new Map();          // tag -> Set<id>

    if (this.persistPath && fs.existsSync(this.persistPath)) {
      this._load();
    }
  }

  /** Generate a unique memory ID */
  static generateId() {
    return `mem_${crypto.randomBytes(8).toString('hex')}`;
  }

  /** Compute semantic hash for deduplication */
  static semanticHash(fact, layer) {
    return crypto.createHash('sha256').update(`${layer}:${fact.toLowerCase().trim()}`).digest('hex').slice(0, 16);
  }

  /** Insert or update a memory record */
  put(record) {
    if (!record.id) record.id = MemoryStore.generateId();
    if (!record.time) record.time = {};
    if (!record.time.valid_from) record.time.valid_from = new Date().toISOString();
    if (!record.confidence && record.confidence !== 0) record.confidence = 0.5;
    if (!record.priority) record.priority = 'medium';
    if (!record.tags) record.tags = [];
    if (!record.source) record.source = {};
    if (!record.supersedes) record.supersedes = [];

    this.records.set(record.id, record);

    // Update indexes
    const layer = record.layer || 'present';
    if (!this._layerIndex.has(layer)) this._layerIndex.set(layer, new Set());
    this._layerIndex.get(layer).add(record.id);

    for (const tag of record.tags) {
      if (!this._tagIndex.has(tag)) this._tagIndex.set(tag, new Set());
      this._tagIndex.get(tag).add(record.id);
    }

    for (const parentId of record.supersedes) {
      this._supersessionIndex.set(record.id, parentId);
    }

    // Enforce max records via LRU-style eviction of lowest priority
    if (this.records.size > this.maxRecords) {
      this._evictLowest();
    }

    return record;
  }

  /** Get a record by ID */
  get(id) {
    return this.records.get(id) || null;
  }

  /** Get all records for a layer */
  getByLayer(layer) {
    const ids = this._layerIndex.get(layer);
    if (!ids) return [];
    return [...ids].map(id => this.records.get(id)).filter(Boolean);
  }

  /** Get all records matching a tag */
  getByTag(tag) {
    const ids = this._tagIndex.get(tag);
    if (!ids) return [];
    return [...ids].map(id => this.records.get(id)).filter(Boolean);
  }

  /** Find records whose fact matches the query via word overlap (case-insensitive) */
  search(query, opts = {}) {
    const layer = opts.layer || null;
    const limit = opts.limit || 20;
    const minScore = opts.minScore ?? 0.1;

    const queryWords = new Set(query.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (queryWords.size === 0) return [];

    const candidates = layer ? this.getByLayer(layer) : [...this.records.values()];
    const scored = [];

    for (const rec of candidates) {
      if (!rec.fact) continue;
      const factWords = new Set(rec.fact.toLowerCase().split(/\s+/).filter(w => w.length > 2));
      if (factWords.size === 0) continue;

      // Jaccard-like: count query words found in fact
      let hits = 0;
      for (const w of queryWords) {
        if (factWords.has(w)) hits++;
      }
      const score = hits / queryWords.size;

      if (score >= minScore) {
        scored.push({ rec, score });
      }
    }

    // Sort by score descending, then return records
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(s => s.rec);

    return results;
  }

  /** Get the latest valid record in a supersession chain */
  resolveChain(id) {
    const visited = new Set();
    let current = this.get(id);
    if (!current) return null;

    // Walk forward: find records that supersede this one
    const reverseIndex = new Map();
    for (const [childId, parentId] of this._supersessionIndex) {
      if (!reverseIndex.has(parentId)) reverseIndex.set(parentId, []);
      reverseIndex.get(parentId).push(childId);
    }

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const children = reverseIndex.get(current.id);
      if (!children || children.length === 0) break;
      // Pick the most recent child
      const sorted = children
        .map(cid => this.get(cid))
        .filter(Boolean)
        .sort((a, b) => (b.time?.valid_from || '').localeCompare(a.time?.valid_from || ''));
      if (sorted.length === 0) break;
      current = sorted[0];
    }

    return current;
  }

  /** Check if a fact is a duplicate via semantic hash */
  isDuplicate(fact, layer) {
    const hash = MemoryStore.semanticHash(fact, layer);
    for (const rec of this.records.values()) {
      if (MemoryStore.semanticHash(rec.fact, rec.layer) === hash) return rec;
    }
    return null;
  }

  /** Remove a record */
  delete(id) {
    const rec = this.records.get(id);
    if (!rec) return false;
    this.records.delete(id);
    // Clean indexes
    if (rec.layer && this._layerIndex.has(rec.layer)) {
      this._layerIndex.get(rec.layer).delete(id);
    }
    for (const tag of (rec.tags || [])) {
      if (this._tagIndex.has(tag)) this._tagIndex.get(tag).delete(id);
    }
    this._supersessionIndex.delete(id);
    return true;
  }

  /** Get total record count */
  get size() {
    return this.records.size;
  }

  /** Export all records as array */
  toArray() {
    return [...this.records.values()];
  }

  /** Persist to disk */
  save() {
    if (!this.persistPath) return;
    const dir = path.dirname(this.persistPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(this.toArray(), null, 2);
    fs.writeFileSync(this.persistPath, data);
  }

  /** Load from disk */
  _load() {
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const arr = JSON.parse(raw);
      for (const rec of arr) this.put(rec);
    } catch { /* ignore corrupt files */ }
  }

  /** Evict lowest-priority, oldest records */
  _evictLowest() {
    const priorityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
    const sorted = this.toArray().sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 1;
      const pb = priorityOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      return (a.time?.valid_from || '').localeCompare(b.time?.valid_from || '');
    });

    const toRemove = sorted.slice(0, Math.ceil(this.maxRecords * 0.1));
    for (const rec of toRemove) this.delete(rec.id);
  }
}
