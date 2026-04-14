"""AnalyticsStoreMixin: computes summary and trend metrics for hub chat usage."""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from ...schemas import (
    AnalyticsTopSource,
    ChatAnalyticsSummary,
    ChatAnalyticsTrendPoint,
    ChatAnalyticsTrends,
    ChatEventType,
    ChatFeedbackRating,
    CitationFeedbackEventType,
    NeverCitedSource,
)
from .common_helpers import _clamp_window_days, _iso_day, _safe_float, _safe_int


class AnalyticsStoreMixin:
    # Aggregate the main answer, feedback, citation, and latency metrics for one hub.
    def get_hub_chat_analytics_summary(
        self,
        hub_id: str,
        *,
        days: Optional[int] = None,
    ) -> ChatAnalyticsSummary:
        window_days = _clamp_window_days(days or self.analytics_summary_days)
        cutoff = (datetime.now(timezone.utc) - timedelta(days=window_days)).isoformat()

        # Pull each event stream separately because the metrics are sourced from different tables.
        event_rows = self.service_client.table("chat_events").select("event_type,metadata,created_at").eq("hub_id", str(hub_id)).gte("created_at", cutoff).execute().data or []
        feedback_rows = self.service_client.table("chat_feedback").select("rating,updated_at").eq("hub_id", str(hub_id)).gte("updated_at", cutoff).execute().data or []
        citation_rows = self.service_client.table("citation_feedback").select("source_id,event_type").eq("hub_id", str(hub_id)).gte("created_at", cutoff).execute().data or []
        answer_events = [row for row in event_rows if row.get("event_type") == ChatEventType.answer_received.value]
        total_questions = sum(1 for row in event_rows if row.get("event_type") == ChatEventType.question_asked.value)
        total_answers = len(answer_events)
        helpful_count = sum(1 for row in feedback_rows if row.get("rating") == ChatFeedbackRating.helpful.value)
        not_helpful_count = sum(1 for row in feedback_rows if row.get("rating") == ChatFeedbackRating.not_helpful.value)
        feedback_total = helpful_count + not_helpful_count
        helpful_rate = round((helpful_count / feedback_total), 3) if feedback_total else 0.0
        average_citations_per_answer = round(sum(_safe_int((row.get("metadata") or {}).get("citation_count")) for row in answer_events) / total_answers, 2) if total_answers else 0.0
        citation_open_count = sum(1 for row in citation_rows if row.get("event_type") == CitationFeedbackEventType.opened.value)
        citation_flag_count = sum(1 for row in citation_rows if row.get("event_type") == CitationFeedbackEventType.flagged_incorrect.value)
        total_citations_shown = sum(_safe_int((row.get("metadata") or {}).get("citation_count")) for row in answer_events)
        citation_open_rate = round((citation_open_count / total_citations_shown), 3) if total_citations_shown else 0.0
        citation_flag_rate = round((citation_flag_count / total_citations_shown), 3) if total_citations_shown else 0.0
        average_latency_ms = round(sum(_safe_float((row.get("metadata") or {}).get("latency_ms")) for row in answer_events) / total_answers, 2) if total_answers else 0.0
        total_tokens = sum(_safe_int((row.get("metadata") or {}).get("total_tokens")) for row in answer_events)
        rewrite_usage_rate = round(sum(1 for row in answer_events if (row.get("metadata") or {}).get("rewrite_used")) / total_answers, 3) if total_answers else 0.0
        zero_hit_rate = round(sum(1 for row in answer_events if (row.get("metadata") or {}).get("zero_hit")) / total_answers, 3) if total_answers else 0.0

        # Rank sources by how often they were returned and interacted with so the summary can surface the most-used material.
        source_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: {"returns": 0, "opens": 0, "flags": 0})
        for row in answer_events:
            source_ids = (row.get("metadata") or {}).get("selected_source_ids") or []
            if not isinstance(source_ids, list):
                continue
            for source_id in source_ids:
                source_id = str(source_id or "")
                if source_id:
                    source_counts[source_id]["returns"] += 1
        for row in citation_rows:
            source_id = str(row.get("source_id") or "")
            if not source_id:
                continue
            if row.get("event_type") == CitationFeedbackEventType.opened.value:
                source_counts[source_id]["opens"] += 1
            elif row.get("event_type") == CitationFeedbackEventType.flagged_incorrect.value:
                source_counts[source_id]["flags"] += 1
        ranked_sources = sorted(source_counts.items(), key=lambda item: (max(item[1]["returns"], item[1]["opens"]), item[1]["opens"], item[1]["flags"], item[0]), reverse=True)

        # Fetch every complete source in the hub once so we can (a) name the ranked list and
        # (b) surface "never cited" sources for coverage gaps.
        hub_source_rows = self.service_client.table("sources").select("id,original_name").eq("hub_id", str(hub_id)).eq("status", "complete").execute().data or []
        hub_source_name_map = {str(row["id"]): str(row.get("original_name") or "") for row in hub_source_rows if row.get("id")}
        cited_source_ids = {source_id for source_id, counts in source_counts.items() if counts["returns"] > 0}
        never_cited_ids = [sid for sid in hub_source_name_map.keys() if sid not in cited_source_ids]
        never_cited_ids.sort(key=lambda sid: hub_source_name_map.get(sid, ""))
        never_cited_sources = [
            NeverCitedSource(source_id=sid, source_name=hub_source_name_map.get(sid) or None)
            for sid in never_cited_ids
        ]
        source_name_map = hub_source_name_map
        return ChatAnalyticsSummary(
            window_days=window_days,
            total_questions=total_questions,
            total_answers=total_answers,
            helpful_count=helpful_count,
            not_helpful_count=not_helpful_count,
            helpful_rate=helpful_rate,
            average_citations_per_answer=average_citations_per_answer,
            citation_open_count=citation_open_count,
            citation_open_rate=citation_open_rate,
            citation_flag_count=citation_flag_count,
            citation_flag_rate=citation_flag_rate,
            average_latency_ms=average_latency_ms,
            total_tokens=total_tokens,
            rewrite_usage_rate=rewrite_usage_rate,
            zero_hit_rate=zero_hit_rate,
            top_sources=[
                AnalyticsTopSource(
                    source_id=source_id,
                    source_name=source_name_map.get(source_id),
                    citation_returns=counts["returns"],
                    citation_opens=counts["opens"],
                    citation_flags=counts["flags"],
                )
                for source_id, counts in ranked_sources
            ],
            never_cited_sources=never_cited_sources,
            never_cited_count=len(never_cited_ids),
            total_complete_sources=len(hub_source_name_map),
        )

    # Build day-by-day analytics points for charts and trend views.
    def get_hub_chat_analytics_trends(
        self,
        hub_id: str,
        *,
        days: Optional[int] = None,
    ) -> ChatAnalyticsTrends:
        window_days = _clamp_window_days(days or self.analytics_trend_days)
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=window_days - 1)
        cutoff = cutoff_dt.isoformat()

        # Pre-seed every day in the window so the API always returns a complete time series.
        event_rows = self.service_client.table("chat_events").select("event_type,created_at").eq("hub_id", str(hub_id)).gte("created_at", cutoff).execute().data or []
        feedback_rows = self.service_client.table("chat_feedback").select("rating,updated_at").eq("hub_id", str(hub_id)).gte("updated_at", cutoff).execute().data or []
        citation_rows = self.service_client.table("citation_feedback").select("event_type,created_at").eq("hub_id", str(hub_id)).gte("created_at", cutoff).execute().data or []
        points: Dict[str, ChatAnalyticsTrendPoint] = {}
        for offset in range(window_days):
            day = (cutoff_dt + timedelta(days=offset)).date().isoformat()
            points[day] = ChatAnalyticsTrendPoint(date=day)
        for row in event_rows:
            day = _iso_day(row.get("created_at"))
            if day not in points:
                continue
            if row.get("event_type") == ChatEventType.question_asked.value:
                points[day].questions += 1
            elif row.get("event_type") == ChatEventType.answer_received.value:
                points[day].answers += 1
        for row in feedback_rows:
            day = _iso_day(row.get("updated_at"))
            if day not in points:
                continue
            rating = row.get("rating")
            if rating == ChatFeedbackRating.helpful.value:
                points[day].helpful += 1
            elif rating == ChatFeedbackRating.not_helpful.value:
                points[day].not_helpful += 1
        for row in citation_rows:
            day = _iso_day(row.get("created_at"))
            if day not in points:
                continue
            if row.get("event_type") == CitationFeedbackEventType.opened.value:
                points[day].citation_opens += 1
            elif row.get("event_type") == CitationFeedbackEventType.flagged_incorrect.value:
                points[day].citation_flags += 1
        return ChatAnalyticsTrends(window_days=window_days, points=[points[day] for day in sorted(points.keys())])
