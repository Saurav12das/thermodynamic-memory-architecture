#!/usr/bin/env node
/**
 * WDMA Multi-Agent Memory Test
 *
 * Creates two agents with different configurations, feeds them the same
 * experiences, quizzes them with D0-D5 questions, and has a researcher
 * evaluate and compare their memory performance.
 *
 * Run: node tests/run-multi-agent-test.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { MemoryAgent } from './memory-agent.js';
import { Researcher } from './researcher.js';
import { EXPERIENCE_CORPUS, QUIZ_QUESTIONS } from './experience-corpus.js';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'tests', 'results');

// ═══════════════════════════════════════════════════════════════════
// Agent A: "Conservative" — high jolt threshold, strict verification
// Only stores truly surprising information. More selective.
// ═══════════════════════════════════════════════════════════════════
const agentA = new MemoryAgent('Agent-A (Conservative)', {
  useJoltEncoding: true,
  joltBaseThreshold: 0.35,       // higher bar to encode
  joltGrowthRate: 0.12,          // threshold rises faster with experience
  joltMaxThreshold: 0.9,
  verificationPassThreshold: 0.4, // stricter verification
  disconfirmationBonus: 0.2,     // stronger anti-echo-chamber
  confidenceFloor: 0.5,          // escalates retrieval more often
  stageThresholds: {
    reactiveToReflective: { minMemories: 10, minQueries: 5 },
    reflectiveToAdaptive: { minPatterns: 3, minReuseRate: 0.05 },
    adaptiveToAutonomous: { minAdaptationSlope: 0.02, minUtilityPerDollar: 50 },
  },
});

// ═══════════════════════════════════════════════════════════════════
// Agent B: "Permissive" — low jolt threshold, relaxed verification
// Stores almost everything. Less selective, broader recall.
// ═══════════════════════════════════════════════════════════════════
const agentB = new MemoryAgent('Agent-B (Permissive)', {
  useJoltEncoding: true,
  joltBaseThreshold: 0.1,        // low bar to encode
  joltGrowthRate: 0.03,          // threshold rises slowly
  joltMaxThreshold: 0.6,
  verificationPassThreshold: 0.2, // relaxed verification
  disconfirmationBonus: 0.05,    // minimal anti-echo-chamber
  confidenceFloor: 0.7,          // escalates less often
  stageThresholds: {
    reactiveToReflective: { minMemories: 10, minQueries: 5 },
    reflectiveToAdaptive: { minPatterns: 3, minReuseRate: 0.05 },
    adaptiveToAutonomous: { minAdaptationSlope: 0.02, minUtilityPerDollar: 50 },
  },
});

const researcher = new Researcher();

// ═══════════════════════════════════════════════════════════════════
// Phase 1: Learning — both agents experience the same events
// ═══════════════════════════════════════════════════════════════════
console.log('========================================');
console.log('  WDMA Multi-Agent Memory Benchmark');
console.log('========================================\n');

console.log('Phase 1: LEARNING');
console.log('─'.repeat(40));
console.log(`Feeding ${EXPERIENCE_CORPUS.length} events to both agents...\n`);

agentA.learn(EXPERIENCE_CORPUS);
agentB.learn(EXPERIENCE_CORPUS);

const summaryA = agentA.getSummary();
const summaryB = agentB.getSummary();

console.log(`  ${summaryA.name}:`);
console.log(`    Stored: ${summaryA.memoriesStored}/${summaryA.totalExperiences} (${summaryA.encodeRate})`);
console.log(`    Stage: ${summaryA.stage} | Probationary: ${summaryA.mitigationStats.probationaryRouted}`);
console.log(`    Jolt domains: ${summaryA.joltStats.domainCount}\n`);

console.log(`  ${summaryB.name}:`);
console.log(`    Stored: ${summaryB.memoriesStored}/${summaryB.totalExperiences} (${summaryB.encodeRate})`);
console.log(`    Stage: ${summaryB.stage} | Probationary: ${summaryB.mitigationStats.probationaryRouted}`);
console.log(`    Jolt domains: ${summaryB.joltStats.domainCount}\n`);

// ═══════════════════════════════════════════════════════════════════
// Phase 2: Quizzing — ask both agents the same D0-D5 questions
// ═══════════════════════════════════════════════════════════════════
console.log('Phase 2: QUIZZING');
console.log('─'.repeat(40));
console.log(`Asking ${QUIZ_QUESTIONS.length} questions (D0-D5)...\n`);

const answersA = [];
const answersB = [];

for (const question of QUIZ_QUESTIONS) {
  const [aA, aB] = await Promise.all([
    agentA.answer(question),
    agentB.answer(question),
  ]);
  answersA.push(aA);
  answersB.push(aB);

  const aStatus = aA.memoriesUsed > 0 ? `${aA.memoriesUsed} mem, ${aA.tier}` : 'no memories';
  const bStatus = aB.memoriesUsed > 0 ? `${aB.memoriesUsed} mem, ${aB.tier}` : 'no memories';

  console.log(`  [${question.level}] ${question.question.slice(0, 55)}...`);
  console.log(`    A: ${aA.answer.slice(0, 70)}... (${aStatus})`);
  console.log(`    B: ${aB.answer.slice(0, 70)}... (${bStatus})\n`);
}

// ═══════════════════════════════════════════════════════════════════
// Phase 3: Evaluation — researcher grades and compares
// ═══════════════════════════════════════════════════════════════════
console.log('Phase 3: EVALUATION');
console.log('─'.repeat(40));

const evalA = researcher.evaluateAgent(summaryA.name, QUIZ_QUESTIONS, answersA);
const evalB = researcher.evaluateAgent(summaryB.name, QUIZ_QUESTIONS, answersB);
const comparison = researcher.compareAgents(evalA, evalB);

// Feed evaluation results back as training signal
for (const grade of evalA.grades) {
  agentA.wdma.feedback(grade.correct, grade.score);
}
for (const grade of evalB.grades) {
  agentB.wdma.feedback(grade.correct, grade.score);
}

console.log('\n  SCORE SUMMARY');
console.log('  ' + '─'.repeat(55));
console.log(`  ${'Metric'.padEnd(25)} ${summaryA.name.padEnd(15)} ${summaryB.name}`);
console.log('  ' + '─'.repeat(55));
console.log(`  ${'Overall Score'.padEnd(25)} ${(evalA.overallScore * 100).toFixed(1).padEnd(15)}% ${(evalB.overallScore * 100).toFixed(1)}%`);
console.log(`  ${'Pass Rate'.padEnd(25)} ${(evalA.overallPassRate * 100).toFixed(1).padEnd(15)}% ${(evalB.overallPassRate * 100).toFixed(1)}%`);
console.log(`  ${'Avg Latency'.padEnd(25)} ${(evalA.avgLatencyMs.toFixed(0) + 'ms').padEnd(15)} ${evalB.avgLatencyMs.toFixed(0)}ms`);
console.log(`  ${'Memories Used (avg)'.padEnd(25)} ${evalA.avgMemoriesUsed.toFixed(1).padEnd(15)} ${evalB.avgMemoriesUsed.toFixed(1)}`);

console.log('\n  D0-D5 BREAKDOWN');
console.log('  ' + '─'.repeat(55));
const levels = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5'];
for (const level of levels) {
  const a = evalA.levelScores[level];
  const b = evalB.levelScores[level];
  if (a && b) {
    const name = `${level} ${a.name}`;
    console.log(`  ${name.padEnd(35)} ${(a.avgScore * 100).toFixed(0).padEnd(15)}% ${(b.avgScore * 100).toFixed(0)}%`);
  }
}

console.log(`\n  WINNER: ${comparison.winner} (by ${(comparison.scoreDelta * 100).toFixed(1)} points)`);

// Wins breakdown
const wins = {};
for (const h2h of comparison.headToHead) {
  wins[h2h.winner] = (wins[h2h.winner] || 0) + 1;
}
console.log('  Wins per agent:');
for (const [agent, count] of Object.entries(wins)) {
  console.log(`    ${agent}: ${count}`);
}

// ═══════════════════════════════════════════════════════════════════
// Phase 4: Generate full report
// ═══════════════════════════════════════════════════════════════════
console.log('\n\nPhase 4: REPORT GENERATION');
console.log('─'.repeat(40));

const report = researcher.generateReport(
  [summaryA, summaryB],
  [evalA, evalB],
  comparison,
);

// Save report
fs.mkdirSync(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const reportPath = path.join(OUT_DIR, `benchmark-report-${ts}.md`);
fs.writeFileSync(reportPath, report);
console.log(`  Report saved: ${path.relative(ROOT, reportPath)}`);

// Save raw results as JSON
const rawPath = path.join(OUT_DIR, `benchmark-raw-${ts}.json`);
fs.writeFileSync(rawPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  agents: { A: summaryA, B: summaryB },
  evaluations: { A: evalA, B: evalB },
  comparison,
  answers: { A: answersA, B: answersB },
}, null, 2));
console.log(`  Raw data saved: ${path.relative(ROOT, rawPath)}`);

// Also generate D0-D5 benchmark from Agent B's memories (broader memory set)
const benchCases = agentB.wdma.generateBenchmark({ casesPerLevel: 3 });
const benchPath = path.join(OUT_DIR, `d0-d5-generated-${ts}.jsonl`);
fs.writeFileSync(benchPath, agentB.wdma.benchmark.toJsonl(benchCases.cases));
console.log(`  Generated D0-D5 benchmark: ${benchCases.metadata.totalCases} cases → ${path.relative(ROOT, benchPath)}`);

// ═══════════════════════════════════════════════════════════════════
// Phase 5: Training Data Generation — memory IS training data
// ═══════════════════════════════════════════════════════════════════
console.log('\n\nPhase 5: TRAINING DATA GENERATION');
console.log('─'.repeat(40));
console.log('  Memory is not just retrieval — memory IS training data.\n');

// Generate full training package from Agent B (more data)
const trainingPackage = agentB.wdma.generateTrainingData();

console.log(`  Training data totals:`);
console.log(`    SFT examples:        ${trainingPackage.totals.sftExamples}`);
console.log(`    DPO preference pairs: ${trainingPackage.totals.dpoExamples}`);
console.log(`    Negative signal:      ${trainingPackage.totals.negativeExamples}`);
console.log(`    Memory-based:         ${trainingPackage.totals.memoryExamples}`);
console.log(`    Curriculum:           ${trainingPackage.totals.curriculumExamples}`);
console.log(`    ─────────────────────`);
console.log(`    TOTAL:                ${trainingPackage.totals.total} training examples\n`);

// Export in multiple formats
const sftPath = path.join(OUT_DIR, `training-sft-${ts}.jsonl`);
const sftData = agentB.wdma.training.exportOpenAIFormat(trainingPackage.sft.data);
fs.writeFileSync(sftPath, sftData);
console.log(`  SFT (OpenAI format):   ${path.relative(ROOT, sftPath)}`);

const dpoPath = path.join(OUT_DIR, `training-dpo-${ts}.jsonl`);
const dpoData = agentB.wdma.training.exportDPOFormat(trainingPackage.dpo.data);
fs.writeFileSync(dpoPath, dpoData);
console.log(`  DPO (preference):      ${path.relative(ROOT, dpoPath)}`);

const memoryPath = path.join(OUT_DIR, `training-memory-${ts}.jsonl`);
const memoryTrainData = agentB.wdma.training.exportOpenAIFormat(trainingPackage.memoryBased.data);
fs.writeFileSync(memoryPath, memoryTrainData);
console.log(`  Memory-as-training:    ${path.relative(ROOT, memoryPath)}`);

const curriculumPath = path.join(OUT_DIR, `training-curriculum-${ts}.jsonl`);
const curriculumData = agentB.wdma.training.exportCurriculumFormat(trainingPackage.curriculum);
fs.writeFileSync(curriculumPath, curriculumData);
console.log(`  Curriculum (D0→D5):    ${path.relative(ROOT, curriculumPath)}`);

// Show curriculum breakdown
console.log(`\n  Curriculum breakdown by level:`);
for (const stage of trainingPackage.curriculum.stages) {
  console.log(`    ${stage.level} ${stage.name}: ${stage.examples.length} examples`);
}

// Show training pipeline stats
console.log(`\n  Training pipeline stats:`);
const tStats = agentB.wdma.training.stats;
console.log(`    Interactions logged:  ${tStats.interactionsLogged}`);
console.log(`    Feedback received:    ${tStats.feedbackReceived}`);
console.log(`    Labeled ratio:        ${tStats.labeledRatio}`);
console.log(`    Replay buffer size:   ${tStats.replayBufferSize}`);
console.log(`    Positive examples:    ${tStats.positiveExamples}`);
console.log(`    Negative examples:    ${tStats.negativeExamples}`);

console.log('\n========================================');
console.log('  Benchmark complete.');
console.log('========================================');
