/**
 * WDMA Ingest Pipeline
 * Four-stage pipeline: I0 (gate) -> I1 (extract) -> I2 (resolve) -> I3 (route + store)
 *
 * Each stage is a function that transforms the event or decides to drop it.
 * Agents provide custom extractors; the pipeline handles structure and conflict resolution.
 */
import { MemoryStore } from './memory-store.js';

/** Default confidence threshold - events below this are dropped at the gate */
const DEFAULT_GATE_THRESHOLD = 0.15;

/** Default batch settings */
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_BATCH_INTERVAL_MS = 5000;

export class IngestPipeline {
  constructor(store, config = {}) {
    this.store = store;
    this.gateThreshold = config.gateThreshold ?? DEFAULT_GATE_THRESHOLD;
    this.batchSize = config.batchSize ?? DEFAULT_BATCH_SIZE;
    this.batchIntervalMs = config.batchIntervalMs ?? DEFAULT_BATCH_INTERVAL_MS;
    this.extractorFn = config.extractor || IngestPipeline.defaultExtractor;
    this.layerRouterFn = config.layerRouter || IngestPipeline.defaultLayerRouter;
    this.onDrop = config.onDrop || null; // callback for dropped events
    this._batch = [];
    this._batchTimer = null;
    this._stats = { received: 0, gated: 0, extracted: 0, conflicts: 0, stored: 0, dropped: 0 };
  }

  // ── I0: Cheap Event Gate ──────────────────────────────────────────

  /**
   * Decide whether an incoming event is worth processing.
   * Returns true to proceed, false to drop.
   */
  gate(event) {
    this._stats.received++;

    // Drop if no content
    if (!event || (!event.text && !event.fact && !event.content)) {
      this._stats.dropped++;
      this.onDrop?.({ stage: 'I0', reason: 'empty', event });
      return false;
    }

    // Drop low-confidence + low-priority noise
    const confidence = event.confidence ?? 0.5;
    const isLowPriority = (event.priority === 'low' || !event.priority);
    if (confidence < this.gateThreshold && isLowPriority) {
      this._stats.dropped++;
      this.onDrop?.({ stage: 'I0', reason: 'below_threshold', event });
      return false;
    }

    this._stats.gated++;
    return true;
  }

  // ── I1: Structured Extractor ──────────────────────────────────────

  /**
   * Transform raw event into a normalized memory record.
   * Override with config.extractor for custom extraction logic.
   */
  extract(event) {
    const record = this.extractorFn(event);
    if (record) this._stats.extracted++;
    return record;
  }

  /** Default extractor: maps common event shapes to memory records */
  static defaultExtractor(event) {
    const fact = event.fact || event.text || event.content || '';
    if (!fact.trim()) return null;

    return {
      id: event.id || MemoryStore.generateId(),
      layer: event.layer || 'present',
      type: event.type || 'event',
      fact: fact.trim(),
      time: {
        valid_from: event.timestamp || event.time?.valid_from || new Date().toISOString(),
        valid_to: event.time?.valid_to || null,
        event_time: event.time?.event_time || null,
      },
      supersedes: event.supersedes || [],
      confidence: event.confidence ?? 0.5,
      priority: event.priority || 'medium',
      tags: event.tags || [],
      source: event.source || {},
    };
  }

  // ── I2: Contradiction / Temporal Resolver ─────────────────────────

  /**
   * Check for conflicts with existing memories and resolve them.
   * Returns the record (possibly modified) or null if it's a duplicate.
   */
  resolve(record) {
    if (!record) return null;

    // Dedup check
    const existing = this.store.isDuplicate(record.fact, record.layer);
    if (existing) {
      // If same fact exists, update confidence if higher
      if (record.confidence > existing.confidence) {
        existing.confidence = record.confidence;
        existing.time.valid_from = record.time.valid_from;
        this.store.put(existing);
      }
      this._stats.dropped++;
      this.onDrop?.({ stage: 'I2', reason: 'duplicate', record, existing });
      return null;
    }

    // Check supersession chain for conflicts
    if (record.supersedes?.length > 0) {
      this._stats.conflicts++;
      for (const parentId of record.supersedes) {
        const parent = this.store.get(parentId);
        if (parent && !parent.time.valid_to) {
          // Close the validity window on the superseded record
          parent.time.valid_to = record.time.valid_from;
          this.store.put(parent);
        }
      }
    }

    return record;
  }

  // ── I3: Layer Router + Batch Writer ───────────────────────────────

  /**
   * Route record to the appropriate layer and write to store.
   */
  route(record) {
    if (!record) return null;

    // Apply custom layer routing if fact/type suggests a different layer
    const routed = this.layerRouterFn(record);
    this.store.put(routed);
    this._stats.stored++;
    return routed;
  }

  /** Default layer router: uses the record's existing layer or infers from type */
  static defaultLayerRouter(record) {
    if (record.layer && record.layer !== 'present') return record;

    const typeLayerMap = {
      identity: 'culture',
      preference: 'culture',
      constraint: 'culture',
      risk_policy: 'culture',
      event: 'past',
      temporal_update: 'past',
      decision: 'present',
      task: 'present',
    };

    record.layer = typeLayerMap[record.type] || 'present';
    return record;
  }

  // ── Full Pipeline ─────────────────────────────────────────────────

  /**
   * Run a single event through the full I0 -> I1 -> I2 -> I3 pipeline.
   * Returns the stored record or null if dropped.
   */
  ingest(event) {
    if (!this.gate(event)) return null;
    const extracted = this.extract(event);
    if (!extracted) return null;
    const resolved = this.resolve(extracted);
    if (!resolved) return null;
    return this.route(resolved);
  }

  /**
   * Ingest multiple events. Processes in order, returns stored records.
   */
  ingestBatch(events) {
    return events.map(e => this.ingest(e)).filter(Boolean);
  }

  /**
   * Add event to batch buffer. Flushes automatically on size or time.
   */
  addToBatch(event) {
    this._batch.push(event);
    if (this._batch.length >= this.batchSize) {
      return this.flushBatch();
    }
    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => this.flushBatch(), this.batchIntervalMs);
    }
    return [];
  }

  /** Flush the batch buffer */
  flushBatch() {
    if (this._batchTimer) {
      clearTimeout(this._batchTimer);
      this._batchTimer = null;
    }
    const events = this._batch.splice(0);
    return this.ingestBatch(events);
  }

  /** Get pipeline statistics */
  get stats() {
    return { ...this._stats };
  }

  /** Reset statistics */
  resetStats() {
    for (const k of Object.keys(this._stats)) this._stats[k] = 0;
  }
}
