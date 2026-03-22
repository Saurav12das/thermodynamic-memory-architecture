# Results

This repository includes two reproducible reference runs:

1. `oracle` — upper-bound sanity check where ground truth is used as predictions.
2. `real-example` — example scored run using `eval/thermo-v1.predictions.example.jsonl`.

> Note: these are **reference/demo runs** on the small seed set in this repo, not a claim of SOTA.

## Latest scores (from `eval/LATEST_SNAPSHOT.md`)

- Accuracy@1: 100%
- Temporal: 100%
- Decision: 100%
- Trust: 100%
- Cost: 100%
- Hallucinated memory rate: 0%
- p50/p95 latency: 2280/2510 ms
- Mean tokens/query: 796.17
- Mean $/query: $0.002533
- Utility-per-dollar: 394.74

For full raw rows and summaries, see JSON artifacts in `eval/results/`.
