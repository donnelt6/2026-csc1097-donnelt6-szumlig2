# Caddie RAG Evals

This folder contains a lightweight offline evaluation harness for Caddie's chat RAG flow.

## Install

Base API dependencies are enough for retrieval and event metrics.

For optional answer-level metrics:

```bash
pip install -e .[evals]
```

## Dataset format

Each JSONL row should include:

```json
{
  "case_id": "orientation-deadline-1",
  "hub_id": "00000000-0000-0000-0000-000000000000",
  "question": "When does orientation start?",
  "scope": "hub",
  "source_ids": [],
  "chat_history": [],
  "expected_source_ids": ["src-1"],
  "reference_answer": "Orientation starts on September 12.",
  "mode": "answer"
}
```

Notes:
- `hub_id` should point at a real hub in the current Supabase project for meaningful results.
- `chat_history` is optional and can include prior `user` / `assistant` turns.
- `mode` may be `answer` or `abstain`.

## Run

```bash
python evals/run_eval.py --dataset evals/dataset.jsonl
```

Reports are written to `eval-results/`.
