from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.schemas import Citation, HubScope
from app.services.store import store


@dataclass
class EvalCase:
    case_id: str
    hub_id: str
    question: str
    scope: str = "hub"
    source_ids: List[str] | None = None
    chat_history: List[Dict[str, Any]] | None = None
    expected_source_ids: List[str] | None = None
    reference_answer: str | None = None
    mode: str = "answer"


def load_cases(path: Path) -> List[EvalCase]:
    cases: List[EvalCase] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        payload = json.loads(stripped)
        cases.append(EvalCase(**payload))
    return cases


def normalize_history(history: List[Dict[str, Any]] | None) -> tuple[List[Dict[str, str]], List[Dict[str, Any]]]:
    history_rows = history or []
    return (
        [{"role": str(item.get("role") or "user"), "content": str(item.get("content") or "")} for item in history_rows],
        [
            {
                "role": str(item.get("role") or "user"),
                "content": str(item.get("content") or ""),
                "citations": item.get("citations") or [],
            }
            for item in history_rows
        ],
    )


def abstained(answer: str) -> bool:
    lowered = (answer or "").lower()
    return any(
        token in lowered
        for token in [
            "don't have enough information",
            "do not have enough information",
            "not enough information",
            "insufficient",
            "can't determine",
            "cannot determine",
        ]
    )


def run_case(case: EvalCase) -> Dict[str, Any]:
    history_messages, retrieval_history = normalize_history(case.chat_history)
    retrieval_source_ids = case.source_ids or None
    started_at = time.perf_counter()
    answer, citations, usage, generation = store._generate_chat_answer(
        store.service_client,
        hub_id=case.hub_id,
        question=case.question,
        scope=HubScope.global_scope if case.scope == "global" else HubScope.hub,
        retrieval_source_ids=retrieval_source_ids,
        history_messages=history_messages,
        retrieval_history=retrieval_history,
        trace=None,
    )
    latency_ms = round((time.perf_counter() - started_at) * 1000, 2)
    retrieved_source_ids = [str(source_id) for source_id in (generation.get("selected_source_ids") or []) if source_id]
    cited_source_ids = [citation.source_id for citation in citations]
    expected_source_ids = case.expected_source_ids or []
    retrieval_overlap = [source_id for source_id in retrieved_source_ids if source_id in expected_source_ids]
    citation_overlap = [source_id for source_id in cited_source_ids if source_id in expected_source_ids]
    recall = len(set(retrieval_overlap)) / len(set(expected_source_ids)) if expected_source_ids else 1.0
    precision = len(set(retrieval_overlap)) / len(set(retrieved_source_ids)) if retrieved_source_ids else (1.0 if not expected_source_ids else 0.0)
    reciprocal_rank = 0.0
    for index, source_id in enumerate(retrieved_source_ids, start=1):
        if source_id in expected_source_ids:
            reciprocal_rank = round(1 / index, 3)
            break
    citation_match_rate = len(citation_overlap) / len(cited_source_ids) if cited_source_ids else 0.0
    abstention_success = None
    if case.mode == "abstain":
        abstention_success = abstained(answer)

    return {
        "case_id": case.case_id,
        "hub_id": case.hub_id,
        "question": case.question,
        "answer": answer,
        "citations": [citation.model_dump() if isinstance(citation, Citation) else citation for citation in citations],
        "retrieved_source_ids": retrieved_source_ids,
        "cited_source_ids": cited_source_ids,
        "expected_source_ids": expected_source_ids,
        "metrics": {
            "recall_at_k": round(recall, 3),
            "precision_at_k": round(precision, 3),
            "reciprocal_rank": reciprocal_rank,
            "citation_match_rate": round(citation_match_rate, 3),
            "abstention_success": abstention_success,
            "latency_ms": latency_ms,
            "total_tokens": int((usage or {}).get("total_tokens") or 0),
        },
        "generation": generation,
    }


def summarise(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not results:
        return {"cases": 0}
    metric_names = [
        "recall_at_k",
        "precision_at_k",
        "reciprocal_rank",
        "citation_match_rate",
        "latency_ms",
        "total_tokens",
    ]
    summary: Dict[str, Any] = {"cases": len(results)}
    for metric in metric_names:
        values = [result["metrics"][metric] for result in results if result["metrics"].get(metric) is not None]
        summary[metric] = round(sum(values) / len(values), 3) if values else None
    abstentions = [result["metrics"]["abstention_success"] for result in results if result["metrics"].get("abstention_success") is not None]
    summary["abstention_success_rate"] = round(sum(1 for value in abstentions if value) / len(abstentions), 3) if abstentions else None
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Caddie RAG evals.")
    parser.add_argument("--dataset", default="evals/dataset.jsonl")
    parser.add_argument("--output-dir", default="eval-results")
    parser.add_argument("--limit", type=int, default=None, help="Limit the number of dataset cases to run.")
    args = parser.parse_args()

    dataset_path = Path(args.dataset)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    cases = load_cases(dataset_path)
    if args.limit is not None:
        cases = cases[: max(args.limit, 0)]
    results = [run_case(case) for case in cases]
    summary = summarise(results)
    report = {
        "summary": summary,
        "results": results,
        "models": {
            "embedding_model": store.embedding_model,
            "chat_model": store.chat_model,
        },
    }

    timestamp = int(time.time())
    output_path = output_dir / f"rag_eval_{timestamp}.json"
    output_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output_path), "summary": summary}, indent=2))


if __name__ == "__main__":
    main()
