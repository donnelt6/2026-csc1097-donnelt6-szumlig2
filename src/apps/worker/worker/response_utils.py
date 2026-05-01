"""Defensive helpers for extracting data from OpenAI SDK responses."""

from typing import Optional


def _get_attr(obj: object, name: str, default: object = None) -> object:
    # The OpenAI SDK returns a mix of dict-like and attribute-based objects
    # depending on version and endpoint, so callers stay defensive here.
    if isinstance(obj, dict):
        return obj.get(name, default)
    return getattr(obj, name, default)


def _extract_response_text(response: object) -> str:
    # Responses API payloads can expose text in multiple shapes, so callers get
    # one normalized string regardless of SDK response layout.
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
                if _get_attr(part, "type") in {"output_text", "text"}:
                    part_text = _get_attr(part, "text")
                    if isinstance(part_text, str) and part_text.strip():
                        return part_text
        item_text = _get_attr(item, "text")
        if isinstance(item_text, str) and item_text.strip():
            return item_text
    return ""


def _extract_usage(response: object) -> Optional[dict]:
    # Preserve usage data when available, but stay tolerant of plain dict or
    # SDK object representations.
    usage = _get_attr(response, "usage")
    if usage is None:
        return None
    if isinstance(usage, dict):
        return usage
    model_dump = getattr(usage, "model_dump", None)
    if callable(model_dump):
        return model_dump()
    return None


def _extract_web_search_results(response: object) -> list[object]:
    # Suggested-source discovery only needs lightweight search result metadata,
    # not the full mixed response object graph.
    output = _get_attr(response, "output", []) or []
    results: list[object] = []
    for item in output:
        if _get_attr(item, "type") != "web_search_call":
            continue
        call = _get_attr(item, "web_search_call", item)
        call_results = _get_attr(call, "results", None)
        if call_results:
            results.extend(call_results)
    return results


__all__ = [
    "_extract_response_text",
    "_extract_usage",
    "_extract_web_search_results",
    "_get_attr",
]
