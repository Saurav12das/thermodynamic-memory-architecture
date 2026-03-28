/**
 * WDMA Researcher Agent
 *
 * Evaluates how well memory agents performed on the D0-D5 quiz.
 * Scores answers, identifies failure patterns, and generates
 * an improvement report.
 */

const LEVEL_NAMES = {
  D0: 'Raw Recall',
  D1: 'Temporal Ordering',
  D2: 'Near-Miss Confabulation',
  D3: 'Contradiction Detection',
  D4: 'Abstraction & Generalization',
  D5: 'Calibration & Uncertainty',
};

export class Researcher {
  constructor() {
    this.evaluations = [];
  }

  /**
   * Grade a single answer against a question.
   */
  gradeAnswer(question, answer) {
    const answerText = (answer.answer || '').toLowerCase();
    let correct = false;
    let score = 0;
    let reasoning = '';

    if (question.answerType === 'contains') {
      const target = (question.ground_truth || '').toLowerCase();
      correct = answerText.includes(target);
      score = correct ? 1.0 : 0.0;
      reasoning = correct
        ? `Answer contains expected "${question.ground_truth}"`
        : `Answer missing expected "${question.ground_truth}"`;
    } else if (question.answerType === 'rubric') {
      const good = question.rubric?.good || [];
      if (good.length === 0) {
        score = 0;
        reasoning = 'No rubric criteria defined';
      } else {
        const hits = good.filter(k => answerText.includes(k.toLowerCase()));
        score = hits.length / good.length;
        correct = score >= 0.5; // at least half the rubric keywords
        reasoning = `Matched ${hits.length}/${good.length} rubric keywords: [${hits.join(', ')}]`;
      }
    }

    // Bonus: reward appropriate uncertainty expression
    const expressesUncertainty = /uncertain|don't know|no information|no memory|not sure|low.?confidence|conflict/i.test(answerText);
    const shouldBeUncertain = question.level === 'D5' || question.level === 'D3';
    let calibrationBonus = 0;
    if (shouldBeUncertain && expressesUncertainty) {
      calibrationBonus = 0.15;
    } else if (!shouldBeUncertain && expressesUncertainty && correct) {
      calibrationBonus = -0.05; // slight penalty for unnecessary hedging when answer is right
    }

    const finalScore = Math.max(0, Math.min(1, score + calibrationBonus));

    return {
      questionId: question.id,
      level: question.level,
      correct,
      score: Number(finalScore.toFixed(3)),
      reasoning,
      calibrationBonus: Number(calibrationBonus.toFixed(3)),
      tier: answer.tier,
      memoriesUsed: answer.memoriesUsed,
      confidence: answer.confidence,
      latencyMs: answer.latencyMs,
    };
  }

  /**
   * Evaluate a full quiz session for one agent.
   */
  evaluateAgent(agentName, questions, answers) {
    const grades = [];
    const answerMap = new Map(answers.map(a => [a.questionId, a]));

    for (const q of questions) {
      const answer = answerMap.get(q.id);
      if (!answer) {
        grades.push({
          questionId: q.id,
          level: q.level,
          correct: false,
          score: 0,
          reasoning: 'No answer provided',
          tier: 'N/A',
          memoriesUsed: 0,
          confidence: 0,
          latencyMs: 0,
        });
        continue;
      }
      grades.push(this.gradeAnswer(q, answer));
    }

    // Aggregate by level
    const byLevel = {};
    for (const g of grades) {
      if (!byLevel[g.level]) byLevel[g.level] = [];
      byLevel[g.level].push(g);
    }

    const levelScores = {};
    for (const [level, lg] of Object.entries(byLevel)) {
      const avgScore = lg.reduce((s, g) => s + g.score, 0) / lg.length;
      const passRate = lg.filter(g => g.correct).length / lg.length;
      levelScores[level] = {
        name: LEVEL_NAMES[level] || level,
        avgScore: Number(avgScore.toFixed(3)),
        passRate: Number(passRate.toFixed(3)),
        count: lg.length,
      };
    }

    // Overall metrics
    const overallScore = grades.reduce((s, g) => s + g.score, 0) / grades.length;
    const overallPassRate = grades.filter(g => g.correct).length / grades.length;
    const avgLatency = grades.reduce((s, g) => s + g.latencyMs, 0) / grades.length;
    const avgMemoriesUsed = grades.reduce((s, g) => s + g.memoriesUsed, 0) / grades.length;

    // Tier usage distribution
    const tierUsage = {};
    for (const g of grades) {
      tierUsage[g.tier] = (tierUsage[g.tier] || 0) + 1;
    }

    const evaluation = {
      agentName,
      overallScore: Number(overallScore.toFixed(3)),
      overallPassRate: Number(overallPassRate.toFixed(3)),
      avgLatencyMs: Number(avgLatency.toFixed(1)),
      avgMemoriesUsed: Number(avgMemoriesUsed.toFixed(1)),
      totalQuestions: grades.length,
      tierUsage,
      levelScores,
      grades,
    };

    this.evaluations.push(evaluation);
    return evaluation;
  }

  /**
   * Compare two agents head-to-head and generate analysis.
   */
  compareAgents(evalA, evalB) {
    const comparison = {
      agents: [evalA.agentName, evalB.agentName],
      winner: evalA.overallScore >= evalB.overallScore ? evalA.agentName : evalB.agentName,
      scoreDelta: Number(Math.abs(evalA.overallScore - evalB.overallScore).toFixed(3)),
      headToHead: [],
      levelComparison: {},
    };

    // Head-to-head per question
    const gradesB = new Map(evalB.grades.map(g => [g.questionId, g]));
    for (const gA of evalA.grades) {
      const gB = gradesB.get(gA.questionId);
      if (gB) {
        comparison.headToHead.push({
          questionId: gA.questionId,
          level: gA.level,
          [evalA.agentName]: { score: gA.score, correct: gA.correct },
          [evalB.agentName]: { score: gB.score, correct: gB.correct },
          winner: gA.score > gB.score ? evalA.agentName : gA.score < gB.score ? evalB.agentName : 'tie',
        });
      }
    }

    // Level comparison
    for (const level of Object.keys(LEVEL_NAMES)) {
      const a = evalA.levelScores[level];
      const b = evalB.levelScores[level];
      if (a && b) {
        comparison.levelComparison[level] = {
          name: LEVEL_NAMES[level],
          [evalA.agentName]: a.avgScore,
          [evalB.agentName]: b.avgScore,
          delta: Number((a.avgScore - b.avgScore).toFixed(3)),
        };
      }
    }

    return comparison;
  }

  /**
   * Generate a structural improvement report based on evaluation results.
   */
  generateReport(agentSummaries, evaluations, comparison) {
    const lines = [];

    lines.push('# WDMA V1 Memory Benchmark Report');
    lines.push(`\nGenerated: ${new Date().toISOString()}`);
    lines.push('\n---\n');

    // ── Agent Summaries ──
    lines.push('## Agent Configurations\n');
    for (const summary of agentSummaries) {
      lines.push(`### ${summary.name}`);
      lines.push(`- Memories stored: ${summary.memoriesStored}/${summary.totalExperiences} (encode rate: ${summary.encodeRate})`);
      lines.push(`- Developmental stage: ${summary.stage}`);
      lines.push(`- Memory count: ${summary.memoryCount}`);
      lines.push(`- Probationary memories: ${summary.mitigationStats.probationaryRouted}`);
      lines.push(`- Jolt domains tracked: ${summary.joltStats.domainCount}`);
      lines.push('');
    }

    // ── Score Summary ──
    lines.push('## Score Summary\n');
    lines.push('| Metric | ' + evaluations.map(e => e.agentName).join(' | ') + ' |');
    lines.push('|--------|' + evaluations.map(() => '---').join('|') + '|');
    lines.push(`| Overall Score | ${evaluations.map(e => (e.overallScore * 100).toFixed(1) + '%').join(' | ')} |`);
    lines.push(`| Pass Rate | ${evaluations.map(e => (e.overallPassRate * 100).toFixed(1) + '%').join(' | ')} |`);
    lines.push(`| Avg Latency | ${evaluations.map(e => e.avgLatencyMs.toFixed(0) + 'ms').join(' | ')} |`);
    lines.push(`| Avg Memories Used | ${evaluations.map(e => e.avgMemoriesUsed.toFixed(1)).join(' | ')} |`);
    lines.push('');

    // ── D0-D5 Breakdown ──
    lines.push('## D0-D5 Level Breakdown\n');
    lines.push('| Level | Name | ' + evaluations.map(e => e.agentName).join(' | ') + ' |');
    lines.push('|-------|------|' + evaluations.map(() => '---').join('|') + '|');
    for (const [level, name] of Object.entries(LEVEL_NAMES)) {
      const scores = evaluations.map(e => {
        const ls = e.levelScores[level];
        return ls ? (ls.avgScore * 100).toFixed(0) + '%' : 'N/A';
      });
      lines.push(`| ${level} | ${name} | ${scores.join(' | ')} |`);
    }
    lines.push('');

    // ── Head-to-Head ──
    if (comparison) {
      lines.push('## Head-to-Head Comparison\n');
      lines.push(`**Winner: ${comparison.winner}** (by ${(comparison.scoreDelta * 100).toFixed(1)} points)\n`);

      const wins = {};
      for (const h2h of comparison.headToHead) {
        wins[h2h.winner] = (wins[h2h.winner] || 0) + 1;
      }
      for (const [agent, count] of Object.entries(wins)) {
        lines.push(`- ${agent}: ${count} wins`);
      }
      lines.push('');
    }

    // ── Detailed Grades ──
    lines.push('## Detailed Question Results\n');
    for (const eval_ of evaluations) {
      lines.push(`### ${eval_.agentName}\n`);
      lines.push('| Q | Level | Score | Pass | Tier | Memories | Reasoning |');
      lines.push('|---|-------|-------|------|------|----------|-----------|');
      for (const g of eval_.grades) {
        lines.push(`| ${g.questionId} | ${g.level} | ${(g.score * 100).toFixed(0)}% | ${g.correct ? 'Y' : 'N'} | ${g.tier} | ${g.memoriesUsed} | ${g.reasoning.slice(0, 60)} |`);
      }
      lines.push('');
    }

    // ── Failure Analysis ──
    lines.push('## Failure Analysis\n');
    for (const eval_ of evaluations) {
      const failures = eval_.grades.filter(g => !g.correct);
      if (failures.length === 0) {
        lines.push(`### ${eval_.agentName}: No failures\n`);
        continue;
      }
      lines.push(`### ${eval_.agentName}: ${failures.length} failures\n`);
      for (const f of failures) {
        lines.push(`- **${f.questionId}** (${LEVEL_NAMES[f.level]}): ${f.reasoning}`);
      }
      lines.push('');
    }

    // ── Structural Recommendations ──
    lines.push('## V2 Improvement Recommendations\n');
    lines.push(this._generateRecommendations(evaluations, agentSummaries));

    return lines.join('\n');
  }

  _generateRecommendations(evaluations, summaries) {
    const recs = [];

    for (const eval_ of evaluations) {
      // Check D1 (temporal) performance
      const d1 = eval_.levelScores['D1'];
      if (d1 && d1.avgScore < 0.6) {
        recs.push('- **Temporal resolution needs strengthening**: D1 scores are below 60%. The supersession chain resolution may not be surfacing the latest fact reliably. Consider adding explicit "latest valid" indicators to retrieved memories.');
      }

      // Check D2 (confabulation) performance
      const d2 = eval_.levelScores['D2'];
      if (d2 && d2.avgScore < 0.6) {
        recs.push('- **Near-miss confabulation resistance is weak**: D2 scores are low. The system is not distinguishing stored facts from plausible-but-wrong variations. Consider adding exact-match verification in the retrieval path.');
      }

      // Check D3 (contradiction) performance
      const d3 = eval_.levelScores['D3'];
      if (d3 && d3.avgScore < 0.6) {
        recs.push('- **Contradiction detection needs work**: D3 scores indicate unresolved conflicts are not being surfaced. Strengthen the conflict resolver to flag unlinked contradictions more aggressively.');
      }

      // Check D5 (calibration) performance
      const d5 = eval_.levelScores['D5'];
      if (d5 && d5.avgScore < 0.6) {
        recs.push('- **Calibration is under-performing**: D5 scores show the system is not appropriately expressing uncertainty for unknown or low-confidence topics. Add an explicit "no relevant memory" response pathway.');
      }
    }

    // Check encode rates
    for (const summary of summaries) {
      const encodeRate = parseFloat(summary.encodeRate);
      if (encodeRate > 90) {
        recs.push(`- **${summary.name} is storing too much**: ${summary.encodeRate} encode rate suggests the jolt threshold is too low. Raise baseThreshold or growthRate to be more selective.`);
      }
      if (encodeRate < 50) {
        recs.push(`- **${summary.name} is too selective**: ${summary.encodeRate} encode rate means important events may be missed. Lower the jolt threshold.`);
      }
    }

    // General V2 recommendations
    recs.push('');
    recs.push('### General V2 Architecture Recommendations');
    recs.push('');
    recs.push('1. **Embedding-based retrieval**: Replace keyword search in R0 with vector embeddings for semantic matching. This would significantly improve recall on D0 and D4 questions.');
    recs.push('2. **LLM-backed verification gate**: The structural verification gate (temporal + source + contradiction) is a good foundation but needs an LLM verifier for nuanced fact-checking.');
    recs.push('3. **Active consolidation**: Trigger consolidation automatically when the system reaches REFLECTIVE stage, not just on manual calls.');
    recs.push('4. **Forgetting curve**: Implement explicit forgetting for L0_buffer memories that don\'t get promoted within a time window.');
    recs.push('5. **Cross-layer retrieval**: Currently retrieval searches within layers. Add cross-layer query fan-out for D4 abstraction questions.');
    recs.push('6. **Feedback loop to jolt encoder**: Use downstream task outcomes to adjust jolt thresholds dynamically, not just domain experience count.');

    return recs.join('\n');
  }
}
