/**
 * WDMA Shared Experience Corpus
 *
 * A realistic set of 30 events that both test agents will experience.
 * Covers temporal updates, contradictions, causal claims, preferences,
 * risk policies, and routine events — designed to exercise every layer
 * of the WDMA architecture.
 */
export const EXPERIENCE_CORPUS = [
  // ── Phase 1: Onboarding (basic facts) ─────────────────────────────
  { fact: 'The project uses Node.js 20 LTS as the runtime', type: 'constraint', layer: 'culture', confidence: 0.95, priority: 'high', tags: ['tech-stack'] },
  { fact: 'Deploy cadence is every two weeks on Wednesday', type: 'event', layer: 'past', confidence: 0.9, tags: ['deploys'] },
  { fact: 'The team lead is Alex Chen', type: 'identity', layer: 'culture', confidence: 1.0, tags: ['team'] },
  { fact: 'All PRs require at least two reviewers before merge', type: 'constraint', layer: 'culture', confidence: 0.95, priority: 'high', tags: ['process'] },
  { fact: 'The primary database is PostgreSQL 15', type: 'constraint', layer: 'culture', confidence: 0.95, tags: ['tech-stack'] },
  { fact: 'Staging environment is at staging.example.com', type: 'event', layer: 'present', confidence: 0.9, tags: ['infra'] },

  // ── Phase 2: Temporal updates (things change) ─────────────────────
  { id: 'deploy_v1', fact: 'Deploy cadence is every two weeks on Wednesday', type: 'event', layer: 'past', confidence: 0.9, tags: ['deploys'] },
  { fact: 'Deploy cadence changed to weekly on Tuesday', type: 'temporal_update', layer: 'past', confidence: 0.95, supersedes: ['deploy_v1'], tags: ['deploys'] },
  { fact: 'New team member Jordan Park joined the backend team', type: 'event', layer: 'past', confidence: 0.85, tags: ['team'] },
  { fact: 'The staging URL moved to staging-v2.example.com', type: 'temporal_update', layer: 'present', confidence: 0.9, tags: ['infra'] },

  // ── Phase 3: Decisions and policies ───────────────────────────────
  { fact: 'For high-uncertainty decisions, default to defer or hedge', type: 'risk_policy', layer: 'culture', confidence: 0.95, priority: 'critical', tags: ['risk'] },
  { fact: 'Private user data must never appear in shared logs or contexts', type: 'risk_policy', layer: 'culture', confidence: 1.0, priority: 'critical', tags: ['privacy', 'risk'] },
  { fact: 'Rollout sequence: backtest then shadow then pilot then guarded production', type: 'decision', layer: 'culture', confidence: 0.9, priority: 'high', tags: ['deploys', 'process'] },
  { fact: 'Use feature flags for all user-facing changes', type: 'constraint', layer: 'culture', confidence: 0.85, tags: ['process'] },

  // ── Phase 4: Causal claims (should be probationary) ───────────────
  { fact: 'Slow API responses are caused by missing database indexes on the users table', type: 'event', confidence: 0.6, tags: ['performance', 'hypothesis'] },
  { fact: 'High memory usage leads to pod restarts in production because of OOM limits', type: 'event', confidence: 0.65, tags: ['infra', 'hypothesis'] },
  { fact: 'Test flakiness is caused by shared mutable state in the test fixtures', type: 'event', confidence: 0.55, tags: ['testing', 'hypothesis'] },

  // ── Phase 5: Routine events (lower novelty) ──────────────────────
  { fact: 'Sprint 14 planning completed successfully', type: 'event', layer: 'past', confidence: 0.7, priority: 'low', tags: ['process'] },
  { fact: 'Weekly standup moved from 9am to 10am', type: 'temporal_update', layer: 'present', confidence: 0.8, tags: ['process'] },
  { fact: 'Code coverage is at 78% as of last CI run', type: 'event', layer: 'present', confidence: 0.75, tags: ['testing'] },
  { fact: 'Sprint 15 planning completed successfully', type: 'event', layer: 'past', confidence: 0.7, priority: 'low', tags: ['process'] },

  // ── Phase 6: Contradictions ───────────────────────────────────────
  { fact: 'The primary database is now MySQL 8 after migration', type: 'temporal_update', layer: 'culture', confidence: 0.7, tags: ['tech-stack'] },
  // ^ contradicts PostgreSQL 15 but without explicit supersedes link

  { fact: 'Alex Chen stepped down; new team lead is Morgan Liu', type: 'temporal_update', layer: 'culture', confidence: 0.9, tags: ['team'] },

  // ── Phase 7: Low-confidence / uncertain ───────────────────────────
  { fact: 'There might be a security vulnerability in the auth middleware', type: 'event', confidence: 0.3, priority: 'high', tags: ['security'] },
  { fact: 'Someone mentioned we should consider switching to Bun runtime', type: 'event', confidence: 0.25, priority: 'low', tags: ['tech-stack'] },

  // ── Phase 8: Future seeds ─────────────────────────────────────────
  { fact: 'Security audit scheduled for next Friday', type: 'event', layer: 'future_seed', confidence: 0.85, priority: 'high', tags: ['security'] },
  { fact: 'Database migration to distributed setup planned for Q3', type: 'event', layer: 'future_seed', confidence: 0.6, tags: ['infra'] },

  // ── Phase 9: Preferences ──────────────────────────────────────────
  { fact: 'Team prefers TypeScript over plain JavaScript for new code', type: 'preference', layer: 'culture', confidence: 0.85, tags: ['tech-stack'] },
  { fact: 'Dark mode is the default for all internal dashboards', type: 'preference', layer: 'culture', confidence: 0.9, tags: ['ui'] },

  // ── Phase 10: Meta / operational ──────────────────────────────────
  { fact: 'Default retrieval tier should be R0 to minimize cost', type: 'constraint', layer: 'culture', confidence: 0.95, priority: 'high', tags: ['cost'] },
];

/**
 * Quiz questions that probe different memory capabilities.
 * Maps to D0-D5 difficulty levels.
 */
export const QUIZ_QUESTIONS = [
  // D0: Raw Recall
  { id: 'q_d0_1', level: 'D0', question: 'What runtime does the project use?', expected: 'Node.js 20 LTS', answerType: 'contains', ground_truth: 'Node.js 20' },
  { id: 'q_d0_2', level: 'D0', question: 'How many reviewers are required for PRs?', expected: 'two', answerType: 'contains', ground_truth: 'two' },
  { id: 'q_d0_3', level: 'D0', question: 'What is the default retrieval tier?', expected: 'R0', answerType: 'contains', ground_truth: 'R0' },

  // D1: Temporal Ordering
  { id: 'q_d1_1', level: 'D1', question: 'What is the CURRENT deploy cadence? (not the original)', expected: 'weekly on Tuesday', answerType: 'contains', ground_truth: 'weekly' },
  { id: 'q_d1_2', level: 'D1', question: 'Who is the CURRENT team lead?', expected: 'Morgan Liu', answerType: 'contains', ground_truth: 'Morgan' },
  { id: 'q_d1_3', level: 'D1', question: 'What is the CURRENT staging URL?', expected: 'staging-v2.example.com', answerType: 'contains', ground_truth: 'staging-v2' },

  // D2: Near-miss confabulation
  { id: 'q_d2_1', level: 'D2', question: 'Is it true that the deploy cadence is monthly on Thursday?', expected: 'No', answerType: 'rubric', rubric: { good: ['no', 'incorrect', 'not', 'weekly', 'Tuesday'] } },
  { id: 'q_d2_2', level: 'D2', question: 'Does the project require three reviewers per PR?', expected: 'No, two', answerType: 'rubric', rubric: { good: ['no', 'two', 'not three'] } },

  // D3: Contradiction Detection
  { id: 'q_d3_1', level: 'D3', question: 'Is the primary database PostgreSQL or MySQL? There seem to be conflicting records.', expected: 'Conflict detected', answerType: 'rubric', rubric: { good: ['conflict', 'contradiction', 'both', 'unclear', 'uncertain', 'PostgreSQL', 'MySQL'] } },
  { id: 'q_d3_2', level: 'D3', question: 'The original deploy cadence was bi-weekly. What replaced it and why was the old one superseded?', expected: 'weekly on Tuesday, superseded', answerType: 'rubric', rubric: { good: ['weekly', 'Tuesday', 'changed', 'superseded', 'updated'] } },

  // D4: Abstraction
  { id: 'q_d4_1', level: 'D4', question: 'Based on all the risk policies stored, what general principle governs high-stakes decisions?', expected: 'defer/hedge + never share private data', answerType: 'rubric', rubric: { good: ['defer', 'hedge', 'private', 'cautious', 'conservative', 'risk'] } },
  { id: 'q_d4_2', level: 'D4', question: 'What pattern do you see in the causal claims that have been stored?', expected: 'performance/infra issues with hypothetical causes', answerType: 'rubric', rubric: { good: ['hypothesis', 'causal', 'caused', 'unverified', 'probation', 'performance'] } },

  // D5: Calibration
  { id: 'q_d5_1', level: 'D5', question: 'What do you know about the quantum computing migration plan?', expected: 'Nothing — should express uncertainty', answerType: 'rubric', rubric: { good: ['no information', 'don\'t know', 'no memory', 'not found', 'no record', 'uncertain'] } },
  { id: 'q_d5_2', level: 'D5', question: 'How confident should we be about the security vulnerability in auth middleware?', expected: 'Low confidence (0.3)', answerType: 'rubric', rubric: { good: ['low', 'uncertain', 'not sure', '30%', '0.3', 'might', 'unconfirmed'] } },
  { id: 'q_d5_3', level: 'D5', question: 'Should we switch to Bun runtime based on what we know?', expected: 'Very low confidence, just a mention', answerType: 'rubric', rubric: { good: ['low', 'uncertain', 'not enough', 'someone mentioned', 'unconfirmed', 'insufficient'] } },
];
