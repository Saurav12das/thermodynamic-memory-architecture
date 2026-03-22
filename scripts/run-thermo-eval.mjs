#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_DATASET = path.join(ROOT, 'eval', 'thermo-v1.seed.jsonl');
const OUT_DIR = path.join(ROOT, 'eval', 'results');

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { dataset: DEFAULT_DATASET, predictions: null, label: 'thermo-v1', oracle: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dataset' && args[i + 1]) out.dataset = path.isAbsolute(args[++i]) ? args[i] : path.join(ROOT, args[i]);
    else if (a === '--predictions' && args[i + 1]) out.predictions = path.isAbsolute(args[++i]) ? args[i] : path.join(ROOT, args[i]);
    else if (a === '--label' && args[i + 1]) out.label = args[++i];
    else if (a === '--oracle') out.oracle = true;
  }
  return out;
}

const readJsonl = (p) => fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const mean = (arr) => (arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0);
const pct = (n) => Number((n * 100).toFixed(2));

function gradeCase(testCase, answer) {
  const a = norm(answer);
  const t = testCase.answerType || 'contains';
  if (t === 'exact') return a === norm(testCase.ground_truth);
  if (t === 'contains') return a.includes(norm(testCase.ground_truth));
  if (t === 'rubric') {
    const good = testCase.rubric?.good || [];
    if (!good.length) return false;
    const hits = good.filter((k) => a.includes(norm(k))).length;
    return hits / good.length >= 0.67;
  }
  return false;
}

function main() {
  const opts = parseArgs(process.argv);
  const dataset = readJsonl(opts.dataset);

  const predictionRows = opts.oracle
    ? dataset.map((d, i) => ({
        id: d.id,
        answer: d.ground_truth || (d.rubric?.good || []).join('; '),
        tokens: 650 + (i % 5) * 40,
        latencyMs: 1400 + (i % 6) * 250,
        costUsd: 0.0018 + (i % 4) * 0.0004,
        tier: i % 10 < 7 ? 'R0' : i % 10 < 9 ? 'R1' : 'R2',
      }))
    : (opts.predictions ? readJsonl(opts.predictions) : []);

  if (!predictionRows.length) {
    const templatePath = path.join(ROOT, 'eval', 'thermo-v1.predictions.template.jsonl');
    const template = dataset.map((d) => JSON.stringify({ id:d.id, answer:'', tokens:0, latencyMs:0, costUsd:0, tier:'R0' })).join('\n') + '\n';
    fs.writeFileSync(templatePath, template);
    console.log(JSON.stringify({ ok:false, message:'No predictions provided.', templatePath }, null, 2));
    return;
  }

  const predById = new Map(predictionRows.map((p) => [p.id, p]));
  const rows = dataset.map((d) => {
    const p = predById.get(d.id) || {};
    return {
      id: d.id,
      track: d.track,
      pass: gradeCase(d, p.answer || ''),
      answer: p.answer || '',
      tokens: Number(p.tokens || 0),
      latencyMs: Number(p.latencyMs || 0),
      costUsd: Number(p.costUsd || 0),
      tier: p.tier || 'R0'
    };
  });

  const tracks = ['temporal', 'decision', 'trust', 'cost'];
  const byTrack = Object.fromEntries(tracks.map((track) => {
    const r = rows.filter((x) => x.track === track);
    return [track, Number((r.filter((x)=>x.pass).length / Math.max(r.length,1)).toFixed(4))];
  }));

  const overallAcc = rows.filter((x)=>x.pass).length / Math.max(rows.length,1);
  const hallucinatedRate = rows.filter((x)=>!x.pass && x.answer).length / Math.max(rows.length,1);
  const tokens = rows.map((r)=>r.tokens).filter((n)=>n>0);
  const lat = rows.map((r)=>r.latencyMs).filter((n)=>n>0).sort((a,b)=>a-b);
  const costs = rows.map((r)=>r.costUsd).filter((n)=>n>0);
  const q = (arr, x) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(x * arr.length))] : 0;
  const tierCounts = rows.reduce((acc,r)=>{acc[r.tier]=(acc[r.tier]||0)+1;return acc;},{});
  const meanCost = mean(costs);

  const summary = {
    label: opts.label,
    dataset: path.relative(ROOT, opts.dataset),
    predictions: opts.oracle ? 'oracle' : path.relative(ROOT, opts.predictions),
    totalCases: rows.length,
    accuracyOverall: Number(overallAcc.toFixed(4)),
    accuracyByTrack: byTrack,
    hallucinatedMemoryRate: Number(hallucinatedRate.toFixed(4)),
    meanTokensPerQuery: Number(mean(tokens).toFixed(2)),
    p50LatencyMs: Number(q(lat, 0.5).toFixed(0)),
    p95LatencyMs: Number(q(lat, 0.95).toFixed(0)),
    meanCostUsdPerQuery: Number(meanCost.toFixed(6)),
    utilityPerDollar: Number((meanCost > 0 ? overallAcc / meanCost : 0).toFixed(2)),
    tierMix: Object.fromEntries(Object.entries(tierCounts).map(([k,v]) => [k, Number((v / rows.length).toFixed(4))]))
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(OUT_DIR, `thermo-eval-${opts.label}-${ts}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));

  const snapshot = `# Thermodynamic Memory Snapshot\n\nGenerated: ${new Date().toISOString()}\nRun: ${path.relative(ROOT, outPath)}\n\n- Accuracy@1: ${pct(summary.accuracyOverall)}%\n- Temporal: ${pct(summary.accuracyByTrack.temporal || 0)}%\n- Decision: ${pct(summary.accuracyByTrack.decision || 0)}%\n- Trust: ${pct(summary.accuracyByTrack.trust || 0)}%\n- Cost: ${pct(summary.accuracyByTrack.cost || 0)}%\n- Hallucinated memory rate: ${pct(summary.hallucinatedMemoryRate)}%\n- p50/p95 latency: ${summary.p50LatencyMs}/${summary.p95LatencyMs} ms\n- Mean tokens/query: ${summary.meanTokensPerQuery}\n- Mean $/query: $${summary.meanCostUsdPerQuery}\n- Utility-per-dollar: ${summary.utilityPerDollar}\n`;
  fs.writeFileSync(path.join(ROOT, 'eval', 'LATEST_SNAPSHOT.md'), snapshot);

  console.log(JSON.stringify({ ok:true, outPath:path.relative(ROOT,outPath), summary }, null, 2));
}

main();
