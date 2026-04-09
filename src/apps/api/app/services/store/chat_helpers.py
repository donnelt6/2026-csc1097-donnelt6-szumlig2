"""Chat-specific helper functions shared across store mixins."""

import json
import re
from typing import Any, Dict, List, Optional

_VAGUE_FOLLOW_UP_PHRASES = {
    "tell me more",
    "more",
    "go on",
    "continue",
    "explain that",
    "expand on that",
    "what about that",
    "what about this",
    "elaborate",
}
_DEICTIC_TOKENS = {"that", "this", "it", "those", "these", "there", "here"}
_FOLLOW_UP_LEAD_TOKENS = {
    "why",
    "how",
    "what",
    "where",
    "when",
    "which",
    "who",
    "is",
    "are",
    "was",
    "were",
    "do",
    "does",
    "did",
    "can",
    "could",
    "would",
    "should",
    "will",
    "have",
    "has",
    "had",
}


# Keep title cleanup here so chat session naming stays consistent across
# creation, regeneration, and fallback paths.
def _normalize_chat_session_title(text: str) -> str:
    collapsed = " ".join((text or "").split()).strip().strip("\"'`")
    collapsed = re.sub(r"^[Tt]itle\s*:\s*", "", collapsed)
    collapsed = re.sub(r"[\r\n]+", " ", collapsed)
    collapsed = re.sub(r"[^\w\s/&+-]", "", collapsed)
    collapsed = re.sub(r"\s+", " ", collapsed).strip()
    if not collapsed:
        return ""
    words = collapsed.split()
    if len(words) > 5:
        words = words[:5]
    normalized = " ".join(words)
    return normalized[:80].strip() or ""


def _fallback_chat_session_title(text: str) -> str:
    collapsed = " ".join((text or "").split()).strip()
    if not collapsed:
        return "New Chat"
    words = collapsed.split()[:5]
    normalized = " ".join(words)
    return normalized[:80].strip() or "New Chat"


def _parse_questions_from_text(raw: str, max_count: int) -> List[str]:
    if not raw:
        return []
    text = raw.strip()
    candidates: List[str] = []
    seen: set[str] = set()

    def _add(items: List[str]) -> None:
        for item in items:
            cleaned = str(item).strip().strip('"').strip("'")
            if not cleaned:
                continue
            if not cleaned.endswith("?"):
                cleaned = cleaned.rstrip(".")
                cleaned = f"{cleaned}?"
            key = cleaned.lower()
            if key in seen:
                continue
            seen.add(key)
            candidates.append(cleaned)
            if len(candidates) >= max_count:
                break

    # LLM output sometimes wraps the array in extra prose, so callers first try
    # the raw payload and then the widest bracketed slice that still looks JSON-like.
    def _load_json_array(value: str) -> Optional[List[str]]:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
        return None

    parsed = _load_json_array(text)
    if parsed is None:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            parsed = _load_json_array(text[start : end + 1])

    if parsed is not None:
        _add(parsed)
        return candidates

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned_lines: List[str] = []
    for line in lines:
        cleaned = re.sub(r"^[\-\*\d\.\)\s]+", "", line).strip()
        if cleaned:
            cleaned_lines.append(cleaned)
    _add(cleaned_lines)
    return candidates


def _parse_steps_from_text(raw: str, max_count: int) -> List[Dict[str, str]]:
    if not raw:
        return []
    text = raw.strip()
    steps: List[Dict[str, str]] = []

    def _clean(value: str) -> str:
        return re.sub(r"^[\-\*\d\.\)\s]+", "", value or "").strip()

    def _add_step(title: Optional[str], instruction: str) -> None:
        if len(steps) >= max_count:
            return
        cleaned_instruction = _clean(instruction)
        if not cleaned_instruction:
            return
        cleaned_title = _clean(title or "")
        steps.append({"title": cleaned_title if cleaned_title else "", "instruction": cleaned_instruction})

    # Generation flows often return either a plain JSON array or a short preamble
    # followed by JSON, so this mirrors the question parser's recovery strategy.
    def _load_json_array(value: str) -> Optional[List[Any]]:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, list):
            return parsed
        return None

    parsed = _load_json_array(text)
    if parsed is None:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            parsed = _load_json_array(text[start : end + 1])

    if parsed is not None:
        for item in parsed:
            if len(steps) >= max_count:
                break
            if isinstance(item, dict):
                title = item.get("title") or item.get("name") or ""
                instruction = item.get("instruction") or item.get("step") or item.get("text") or ""
                _add_step(title, str(instruction))
            else:
                _add_step("", str(item))
        return steps

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if len(steps) >= max_count:
            break
        _add_step("", line)
    return steps


class _QuotePair:
    """A paraphrase + approximate direct quote pair from the LLM."""

    __slots__ = ("paraphrase", "quote")

    def __init__(self, paraphrase: str, quote: str) -> None:
        self.paraphrase = paraphrase
        self.quote = quote


# Grounded answer generation appends a trailing `QUOTES:` JSON block. This
# helper peels that block off while still accepting the legacy quote-only shape.
def _extract_quotes(raw_answer: str) -> tuple[str, Dict[str, List[_QuotePair]]]:
    marker = "QUOTES:"
    idx = raw_answer.rfind(marker)
    if idx == -1:
        return raw_answer.strip(), {}
    answer = raw_answer[:idx].strip()
    json_part = raw_answer[idx + len(marker) :].strip()
    try:
        quotes = json.loads(json_part)
        if isinstance(quotes, dict):
            result: Dict[str, List[_QuotePair]] = {}
            for key, value in quotes.items():
                pairs: List[_QuotePair] = []
                items = value if isinstance(value, list) else [value]
                for item in items:
                    if isinstance(item, dict):
                        paraphrase = str(item.get("paraphrase") or "").strip()
                        quote = str(item.get("quote") or "").strip()
                        if quote:
                            pairs.append(_QuotePair(paraphrase=paraphrase, quote=quote))
                    elif isinstance(item, str) and item.strip():
                        pairs.append(_QuotePair(paraphrase="", quote=item.strip()))
                if pairs:
                    result[str(key)] = pairs
            return answer, result
    except (json.JSONDecodeError, ValueError):
        pass
    return answer, {}


def _match_quote_pairs_to_snippet(
    pairs: list,
    snippet: str,
    threshold: float = 0.45,
) -> list[tuple[str, str]]:
    # Matching all quote pairs together avoids one early fuzzy match consuming
    # the best snippet region and leaving later citations with lower-quality text.
    snippet_lower = snippet.lower()
    s_words = snippet_lower.split()
    if not s_words:
        return []

    stop_words = frozenset(
        "a an the is are was were be been being have has had do does did "
        "will would could should may might shall can to of in for on with "
        "at by from it its this that and or but not no if so as than you "
        "your he she they them their we our".split()
    )

    word_starts: list[int] = []
    word_ends: list[int] = []
    pos = 0
    for word in s_words:
        idx = snippet_lower.index(word, pos)
        word_starts.append(idx)
        word_ends.append(idx + len(word))
        pos = idx + len(word)

    all_candidates: list[list[tuple[float, int, int, str]]] = []
    for pair in pairs:
        quote = (pair.quote or "").strip()
        if not quote:
            all_candidates.append([])
            continue

        candidates: list[tuple[float, int, int, str]] = []
        q_lower = quote.lower()
        search_pos = 0
        while search_pos < len(snippet_lower):
            idx = snippet_lower.find(q_lower, search_pos)
            if idx == -1:
                break
            candidates.append((1.0, idx, idx + len(q_lower), quote))
            search_pos = idx + 1

        q_words_list = quote.lower().split()
        if len(q_words_list) >= 3:
            q_content = {word for word in q_words_list if word not in stop_words}
            if len(q_content) < 2:
                q_content = set(q_words_list)

            min_win = max(3, len(q_words_list) // 2)
            max_win = min(len(s_words), len(q_words_list) * 4)
            scored_windows: list[tuple[float, int, int]] = []
            for win_size in range(min_win, max_win + 1, max(1, (max_win - min_win) // 8)):
                for start in range(0, len(s_words) - win_size + 1, max(1, win_size // 5)):
                    window_content = {word for word in s_words[start : start + win_size] if word not in stop_words}
                    overlap = len(q_content & window_content)
                    recall = overlap / len(q_content)
                    precision = overlap / max(len(window_content), 1)
                    score = recall * 0.7 + precision * 0.3
                    if score >= threshold:
                        scored_windows.append((score, start, start + win_size))

            scored_windows.sort(key=lambda item: item[0], reverse=True)
            for score, ws, we in scored_windows[:5]:
                cs = word_starts[ws]
                ce = word_ends[min(we - 1, len(word_ends) - 1)]
                candidates.append((score, cs, ce, snippet[cs:ce]))

        all_candidates.append(candidates)

    # Pick the strongest non-overlapping regions globally rather than greedily
    # per quote so multi-citation answers stay aligned with distinct evidence.
    assignment: dict[int, tuple[float, int, int, str]] = {}
    claimed_ranges: list[tuple[int, int]] = []
    flat: list[tuple[float, int, tuple[float, int, int, str]]] = []
    for pair_idx, candidates in enumerate(all_candidates):
        for candidate in candidates:
            flat.append((candidate[0], pair_idx, candidate))
    flat.sort(key=lambda item: item[0], reverse=True)

    for _score, pair_idx, candidate in flat:
        if pair_idx in assignment:
            continue
        c_start, c_end = candidate[1], candidate[2]
        overlaps = False
        for start, end in claimed_ranges:
            if c_start < end and c_end > start:
                overlaps = True
                break
        if not overlaps:
            assignment[pair_idx] = candidate
            claimed_ranges.append((c_start, c_end))
        if len(assignment) == len(pairs):
            break

    result: list[tuple[str, str]] = []
    for index, pair in enumerate(pairs):
        if index in assignment:
            matched_text = assignment[index][3]
            paraphrase = (pair.paraphrase or matched_text).strip()
            result.append((matched_text, paraphrase))
    return result


def _answer_has_citation(answer: str, max_index: int) -> bool:
    if not answer:
        return False
    for match in re.findall(r"\[(\d+)\]", answer):
        try:
            idx = int(match)
        except ValueError:
            continue
        if 1 <= idx <= max_index:
            return True
    return False


def _looks_like_grounded_answer(answer: str) -> bool:
    cleaned = re.sub(r"\s+", " ", (answer or "")).strip()
    if not cleaned:
        return False
    lowered = cleaned.lower()
    abstention_markers = [
        "don't have enough information",
        "do not have enough information",
        "not enough information",
        "insufficient information",
        "cannot determine",
        "can't determine",
    ]
    return not any(marker in lowered for marker in abstention_markers)


def _referenced_citation_indices(answer: str, max_index: int) -> List[int]:
    if not answer or max_index <= 0:
        return []
    indices: List[int] = []
    seen: set[int] = set()
    for match in re.findall(r"\[(\d+)\]", answer):
        try:
            idx = int(match)
        except ValueError:
            continue
        if 1 <= idx <= max_index and idx not in seen:
            seen.add(idx)
            indices.append(idx)
    return indices


def _is_exploratory_chat_question(question: str) -> bool:
    normalized = re.sub(r"\s+", " ", (question or "").strip().lower())
    if not normalized:
        return False
    return any(
        marker in normalized
        for marker in [
            "compare",
            "difference",
            "differences",
            "across",
            "versus",
            "vs",
            "overview",
            "summarize",
            "summary",
            "options",
            "pros and cons",
        ]
    )


def _is_vague_follow_up(question: str) -> bool:
    normalized = re.sub(r"\s+", " ", (question or "").strip().lower())
    if not normalized:
        return False
    if normalized in _VAGUE_FOLLOW_UP_PHRASES:
        return True
    tokens = re.findall(r"\b[\w']+\b", normalized)
    if not tokens:
        return False
    if len(tokens) <= 4 and any(token in _DEICTIC_TOKENS for token in tokens):
        return True
    # Longer follow-ups like "why there?" should still trigger rewrite when the
    # opening token is interrogative and the rest points back to prior context.
    return tokens[0] in _FOLLOW_UP_LEAD_TOKENS and _has_context_reference(tokens)


def _most_recent_informative_user_turn(history: List[Dict[str, Any]]) -> Optional[str]:
    for message in reversed(history):
        if str(message.get("role") or "") != "user":
            continue
        content = str(message.get("content") or "").strip()
        if content and not _is_vague_follow_up(content):
            return content
    return None


def _history_has_multi_source_grounding(history: List[Dict[str, Any]]) -> bool:
    grounded_sources: set[str] = set()
    for message in history:
        if str(message.get("role") or "") != "assistant":
            continue
        for citation in message.get("citations") or []:
            if isinstance(citation, dict):
                source_id = str(citation.get("source_id") or "").strip()
            else:
                source_id = str(getattr(citation, "source_id", "") or "").strip()
            if source_id:
                grounded_sources.add(source_id)
            if len(grounded_sources) >= 2:
                return True
    return False


def _count_distinct_citation_sources(citations: List[Any]) -> int:
    distinct_sources: set[str] = set()
    for citation in citations:
        if isinstance(citation, dict):
            source_id = str(citation.get("source_id") or "").strip()
        else:
            source_id = str(getattr(citation, "source_id", "") or "").strip()
        if source_id:
            distinct_sources.add(source_id)
    return len(distinct_sources)


def _has_context_reference(tokens: List[str]) -> bool:
    for index, token in enumerate(tokens):
        if token in {"that", "it", "those", "these"}:
            return True
        if token in {"there", "here"} and index == len(tokens) - 1:
            return True
        if token == "this" and index == len(tokens) - 1:
            return True
    return False


def _build_anchored_retrieval_query(anchor_turn: str, query_suffix: str) -> str:
    anchor = (anchor_turn or "").strip()
    suffix = (query_suffix or "").strip()
    if not anchor:
        return suffix
    if not suffix:
        return anchor
    if anchor.lower() == suffix.lower():
        return anchor
    # Keep punctuation stable so the anchored query reads like one prompt rather
    # than two jammed strings when it is sent back through retrieval.
    separator = "" if anchor.endswith((".", "?", "!")) else "."
    return f"{anchor}{separator} {suffix}".strip()


def _normalize_retrieval_query(original_question: str, rewritten_query: str) -> str:
    candidate = (rewritten_query or "").replace("\r", "\n").strip()
    if not candidate:
        return original_question
    candidate = candidate.splitlines()[0].strip().strip("`'\" ")
    if ":" in candidate:
        prefix, remainder = candidate.split(":", 1)
        if prefix.strip().lower() in {"query", "rewritten query", "search query"}:
            candidate = remainder.strip()
    candidate = re.sub(r"\[\d+\]", "", candidate)
    candidate = re.sub(r"\s+", " ", candidate).strip()
    if not candidate or candidate.lower() in {"n/a", "none"}:
        return original_question
    return candidate


def _hub_answer_system_prompt() -> str:
    return (
        "You are Caddie, an onboarding assistant. Answer using the provided context only. "
        "Do not infer or invent unstated dates, names, deadlines, policies, contacts, locations, or requirements. "
        "If the context is insufficient, say you don't have enough information. "
        "Every factual claim supported by the context must include an inline citation like [n] that matches the context list. "
        "Do not give an uncited factual answer. "
        "If the user sends small talk or a greeting, respond politely and ask how you can help.\n\n"
        "After your answer, on a new line, output QUOTES: followed by a JSON object.\n"
        "For each citation number you used, provide an array of objects with two fields:\n"
        '- "paraphrase": a short, clean summary of the point you are making (one sentence).\n'
        '- "quote": copy a passage from the context that supports the point. '
        "Copy it as closely as possible from the source text, even if messy or repetitive. "
        "It does not need to be exact but should contain enough key words to locate the region.\n"
        "Include all distinct pieces of information you used, not just one. Example:\n"
        'QUOTES: {"1": [{"paraphrase": "clean summary of point", "quote": "approximate passage from context 1"}], '
        '"3": [{"paraphrase": "another clean summary", "quote": "approximate passage from context 3"}]}'
    )


def _hub_answer_repair_prompt() -> str:
    return (
        "You are revising an onboarding answer to ensure strict grounding. "
        "Use the provided context only. Do not infer unstated facts. "
        "Every factual claim must include an inline citation like [n]. "
        "If you cannot support a claim with the provided context, say you don't have enough information instead of answering it. "
        "Return a corrected answer with citations, then on a new line output QUOTES: JSON in the same format as requested."
    )


def _preview_text(value: Any, limit: int = 140) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return f"{text[: max(0, limit - 1)].rstrip()}..."


def _build_search_snippet(content: str, query: str, radius: int = 72) -> tuple[str, str | None]:
    collapsed = re.sub(r"\s+", " ", (content or "")).strip()
    normalized_query = re.sub(r"\s+", " ", (query or "")).strip()
    if not collapsed or not normalized_query:
        return "", None
    lower_content = collapsed.lower()
    lower_query = normalized_query.lower()
    index = lower_content.find(lower_query)
    if index == -1:
        words = [word for word in lower_query.split(" ") if word]
        index = next((lower_content.find(word) for word in words if lower_content.find(word) != -1), -1)
        if index == -1:
            return "", None
        matched_text = next((word for word in words if lower_content.find(word) == index), None)
    else:
        matched_text = collapsed[index : index + len(normalized_query)]

    start = max(0, index - radius)
    end = min(len(collapsed), index + len(matched_text or normalized_query) + radius)
    snippet = collapsed[start:end].strip()
    if start > 0:
        snippet = f"...{snippet}"
    if end < len(collapsed):
        snippet = f"{snippet}..."
    return snippet, matched_text


def _chat_search_score(session_title: str, snippet: str, matched_text: str, matched_role: str) -> int:
    haystack = f"{session_title} {snippet}".lower()
    needle = (matched_text or "").lower()
    if not haystack or not needle:
        return 0
    occurrences = haystack.count(needle)
    starts_sentence = 1 if needle and needle in haystack[: max(len(needle) + 16, 24)] else 0
    title_boost = 100 if matched_role == "title" else 0
    return title_boost + occurrences * 10 + starts_sentence


__all__ = [
    "_QuotePair",
    "_answer_has_citation",
    "_build_anchored_retrieval_query",
    "_build_search_snippet",
    "_chat_search_score",
    "_count_distinct_citation_sources",
    "_extract_quotes",
    "_fallback_chat_session_title",
    "_has_context_reference",
    "_history_has_multi_source_grounding",
    "_hub_answer_repair_prompt",
    "_hub_answer_system_prompt",
    "_is_exploratory_chat_question",
    "_is_vague_follow_up",
    "_looks_like_grounded_answer",
    "_match_quote_pairs_to_snippet",
    "_most_recent_informative_user_turn",
    "_normalize_chat_session_title",
    "_normalize_retrieval_query",
    "_parse_questions_from_text",
    "_parse_steps_from_text",
    "_preview_text",
    "_referenced_citation_indices",
]
