"""Shared store helper functions used across multiple domains."""

import json
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from postgrest.exceptions import APIError

from ...schemas import Citation


def _average_similarity(matches: List[Dict[str, Any]]) -> float:
    if not matches:
        return 0.0
    values = [float(match.get("similarity") or 0) for match in matches]
    return sum(values) / len(values)


def _normalize_embedding_value(value: Any) -> Optional[List[float]]:
    vector = _coerce_embedding_value(value)
    if vector is None:
        return None
    return _normalize_vector(vector)


def _coerce_embedding_value(value: Any) -> Optional[List[float]]:
    # Retrieval rows and RPC responses sometimes hand vectors back as JSON text
    # rather than native lists, so this helper accepts both shapes.
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            try:
                return [float(item) for item in parsed]
            except (TypeError, ValueError):
                return None
    return None


def _normalize_vector(vector: Optional[List[float]]) -> Optional[List[float]]:
    if not vector:
        return None
    magnitude = math.sqrt(sum(value * value for value in vector))
    if magnitude <= 0:
        return None
    return [value / magnitude for value in vector]


def _cosine_similarity(left: Optional[List[float]], right: Optional[List[float]]) -> float:
    if left is None or right is None or len(left) != len(right):
        return 0.0
    return sum(left_value * right_value for left_value, right_value in zip(left, right))


def _get_attr(obj: Any, name: str, default: Any = None) -> Any:
    # OpenAI SDK objects vary between dict-like and attribute-based payloads
    # across endpoints and versions, so callers stay defensive through one shim.
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _escape_ilike_pattern(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _is_missing_hub_optional_column_error(exc: APIError) -> bool:
    message = (getattr(exc, "message", "") or str(exc)).lower()
    if "column" not in message or "does not exist" not in message:
        return False
    return "icon_key" in message or "archived_at" in message


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _iso_day(value: Any) -> str:
    if isinstance(value, datetime):
        return value.date().isoformat()
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return datetime.now(timezone.utc).date().isoformat()


def _clamp_window_days(value: int) -> int:
    return max(1, min(int(value), 90))


def _is_uuid_like(value: str) -> bool:
    try:
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def _total_tokens_from_usage(usage: Optional[Dict[str, Any]]) -> int:
    if not usage:
        return 0
    total = usage.get("total_tokens")
    if total is not None:
        return _safe_int(total)
    return _safe_int(usage.get("input_tokens")) + _safe_int(usage.get("output_tokens"))


def _extract_response_text(response: Any) -> str:
    # Response payloads can expose text at the top level or nested inside
    # message/content parts depending on the SDK surface used.
    text = _get_attr(response, "output_text")
    if isinstance(text, str) and text.strip():
        return text
    output = _get_attr(response, "output", []) or []
    for item in output:
        if _get_attr(item, "type") != "message":
            continue
        content = _get_attr(item, "content", [])
        if isinstance(content, list):
            for part in content:
                part_type = _get_attr(part, "type")
                if part_type in {"output_text", "text"}:
                    text = _get_attr(part, "text")
                    if isinstance(text, str) and text.strip():
                        return text
        text = _get_attr(item, "text")
        if isinstance(text, str) and text.strip():
            return text
    return ""


def _extract_usage(response: Any) -> Optional[dict]:
    usage = _get_attr(response, "usage")
    if usage is None:
        return None
    if isinstance(usage, dict):
        return usage
    dump = getattr(usage, "model_dump", None)
    if callable(dump):
        return dump()
    return None


def _extract_web_results(response: Any) -> list[Any]:
    # Web-search tool calls are attached as output items rather than a single
    # normalized field, so gather them into one caller-friendly list here.
    output = _get_attr(response, "output", []) or []
    results: list[Any] = []
    for item in output:
        if _get_attr(item, "type") != "web_search_call":
            continue
        call = _get_attr(item, "web_search_call", item)
        call_results = _get_attr(call, "results", None)
        if call_results:
            results.extend(call_results)
    return results


def _format_web_snippet(title: str, snippet: str, url: str) -> str:
    parts = []
    if title:
        parts.append(title)
    if snippet:
        parts.append(snippet)
    if url:
        parts.append(f"source: {url}")
    return " - ".join(parts)


def _build_web_citations(response: Any) -> List[Citation]:
    # Preserve a stable synthetic id when the search result does not expose a
    # usable URL so the citation list still has deterministic source ids.
    results = _extract_web_results(response)
    citations: List[Citation] = []
    for idx, result in enumerate(results, start=1):
        title = _get_attr(result, "title", "") or ""
        snippet = _get_attr(result, "snippet", "") or _get_attr(result, "content", "") or ""
        url = _get_attr(result, "url", "") or _get_attr(result, "link", "") or ""
        citation_id = url or f"web-{idx}"
        citations.append(Citation(source_id=citation_id, snippet=_format_web_snippet(title, snippet, url)))
    return citations


__all__ = [
    "_average_similarity",
    "_build_web_citations",
    "_clamp_window_days",
    "_coerce_embedding_value",
    "_cosine_similarity",
    "_escape_ilike_pattern",
    "_extract_response_text",
    "_extract_usage",
    "_extract_web_results",
    "_format_web_snippet",
    "_get_attr",
    "_is_missing_hub_optional_column_error",
    "_is_uuid_like",
    "_iso_day",
    "_normalize_embedding_value",
    "_normalize_vector",
    "_safe_float",
    "_safe_int",
    "_total_tokens_from_usage",
]
