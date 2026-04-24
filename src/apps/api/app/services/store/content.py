"""ContentStoreMixin: manages FAQ and guide CRUD plus their AI-assisted generation flows."""

from datetime import datetime, timezone
from typing import Dict, List, Optional
import re
import uuid

from supabase import Client

from ...schemas import (
    Citation,
    FaqEntry,
    FaqGenerateRequest,
    GuideEntry,
    GuideGenerateRequest,
    GuideStep,
    GuideStepCreateRequest,
    GuideStepProgressUpdate,
    GuideStepWithProgress,
)
from .base import logger
from .chat_helpers import _answer_has_citation, _parse_questions_from_text, _parse_steps_from_text
from .common_helpers import _average_similarity
from .source_helpers import _trim_text


class ContentStoreMixin:
    # Return all non-archived FAQ entries for a hub.
    def list_faqs(self, client: Client, hub_id: str) -> List[FaqEntry]:
        response = (
            client.table("faq_entries")
            .select("*")
            .eq("hub_id", str(hub_id))
            .is_("archived_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        return [FaqEntry(**row) for row in response.data]

    # Create a manual FAQ entry, reusing an identical existing entry when possible.
    def create_faq(self, client: Client, hub_id: str, user_id: str, question: str, answer: str) -> FaqEntry:
        existing = (
            client.table("faq_entries")
            .select("*")
            .eq("hub_id", hub_id)
            .eq("question", question)
            .eq("answer", answer)
            .is_("archived_at", "null")
            .limit(1)
            .execute()
        )
        if existing.data:
            return FaqEntry(**existing.data[0])
        now = datetime.now(timezone.utc).isoformat()
        row = {
            "hub_id": hub_id,
            "question": question,
            "answer": answer,
            **self._build_topic_payload(self._safe_topic_labels_for_faq(question, answer)),
            "citations": [],
            "source_ids": [],
            "confidence": 1.0,
            "created_at": now,
            "created_by": user_id,
        }
        response = client.table("faq_entries").insert(row).execute()
        return FaqEntry(**response.data[0])

    # Fetch one FAQ entry by id.
    def get_faq(self, client: Client, faq_id: str) -> FaqEntry:
        response = client.table("faq_entries").select("*").eq("id", str(faq_id)).limit(1).execute()
        if not response.data:
            raise KeyError("FAQ entry not found")
        return FaqEntry(**response.data[0])

    # Generate grounded FAQ entries from selected sources, respecting the hub FAQ limit.
    def generate_faqs(self, client: Client, user_id: str, payload: FaqGenerateRequest) -> List[FaqEntry]:
        hub_id = str(payload.hub_id)
        source_ids = [str(source_id) for source_id in payload.source_ids]
        if not source_ids:
            raise ValueError("Select at least one source to generate FAQs.")
        existing = client.table("faq_entries").select("question").eq("hub_id", hub_id).is_("archived_at", "null").execute()
        existing_questions = [q["question"] for q in existing.data]
        faq_limit = 55
        remaining = faq_limit - len(existing_questions)
        if remaining <= 0:
            raise ValueError(f"This hub already has {len(existing_questions)} FAQs (limit {faq_limit}).")
        count = payload.count or self.faq_default_count
        count = max(1, min(int(count), 20, remaining))
        context_chunks: List[dict] = []
        for source_id in source_ids:
            context_chunks.extend(self._fetch_source_context(client, hub_id, source_id, self.faq_context_chunks_per_source))
        if not context_chunks:
            return []
        context_blocks = [
            f"Source {chunk.get('source_id')} [chunk {chunk.get('chunk_index')}]: {_trim_text(chunk.get('text') or '', 900)}"
            for chunk in context_chunks
        ]

        # Ask the model for candidate questions first, then answer each question against retrieved chunks.
        questions = self._generate_faq_questions(context_blocks, count, existing_questions)
        logger.info("FAQ generation: LLM returned %d questions: %s", len(questions), questions)
        if not questions:
            return []
        existing_normalised = {re.sub(r"[^a-z0-9\s]", "", q.lower()).strip() for q in existing_questions}
        before_dedup = len(questions)
        questions = [q for q in questions if re.sub(r"[^a-z0-9\s]", "", q.lower()).strip() not in existing_normalised]
        logger.info("FAQ generation: %d/%d survived dedup filter", len(questions), before_dedup)
        if not questions:
            return []
        entries_payload: List[dict] = []
        now = datetime.now(timezone.utc).isoformat()
        batch_id = str(uuid.uuid4())
        for question in questions:
            query_embedding = self._embed_query(question)
            raw_matches = self._match_chunks(client, hub_id, query_embedding, self.retrieval_candidate_pool, source_ids)
            matches = self._select_matches(raw_matches, query_embedding, self.faq_min_similarity, self.faq_max_citations, fallback_mode="faq")
            if not matches:
                continue
            citations: List[Citation] = []
            answer_context: List[str] = []
            for idx, match in enumerate(matches, start=1):
                trimmed = _trim_text(match.get("text") or "", 600)
                citations.append(Citation(source_id=match["source_id"], snippet=trimmed, chunk_index=match.get("chunk_index")))
                answer_context.append(f"[{idx}] {trimmed}")
            answer = self._generate_faq_answer(question, answer_context)
            if not _answer_has_citation(answer, len(answer_context)):
                continue
            confidence = _average_similarity(matches)
            entries_payload.append(
                {
                    "hub_id": hub_id,
                    "question": question,
                    "answer": answer,
                    **self._build_topic_payload(self._safe_topic_labels_for_faq(question, answer)),
                    "citations": [citation.model_dump() for citation in citations],
                    "source_ids": source_ids,
                    "confidence": confidence,
                    "is_pinned": False,
                    "created_by": user_id,
                    "updated_by": user_id,
                    "updated_at": now,
                    "generation_batch_id": batch_id,
                }
            )
        if not entries_payload:
            return []
        response = client.table("faq_entries").insert(entries_payload).execute()
        return [FaqEntry(**row) for row in response.data]

    # Apply partial updates to an FAQ entry.
    def update_faq(self, client: Client, faq_id: str, payload: dict) -> FaqEntry:
        if "answer" in payload:
            payload = {**payload, "citations": [], "confidence": 1.0}
        if "question" in payload or "answer" in payload:
            existing = self.get_faq(client, faq_id)
            question = payload.get("question", existing.question)
            answer = payload.get("answer", existing.answer)
            payload = {**payload, **self._build_topic_payload(self._safe_topic_labels_for_faq(question, answer))}
        response = client.table("faq_entries").update(payload).eq("id", str(faq_id)).execute()
        if not response.data:
            raise KeyError("FAQ entry not found")
        return FaqEntry(**response.data[0])

    # Soft-archive an FAQ entry and stamp who updated it.
    def archive_faq(self, client: Client, faq_id: str, user_id: str) -> FaqEntry:
        now = datetime.now(timezone.utc).isoformat()
        response = client.table("faq_entries").update({"archived_at": now, "updated_at": now, "updated_by": user_id}).eq("id", str(faq_id)).execute()
        if not response.data:
            raise KeyError("FAQ entry not found")
        return FaqEntry(**response.data[0])

    # Return non-archived guides with their steps and the current user's step completion state.
    def list_guides(self, client: Client, user_id: str, hub_id: str) -> List[GuideEntry]:
        response = (
            client.table("guide_entries")
            .select("*")
            .eq("hub_id", str(hub_id))
            .is_("archived_at", "null")
            .order("created_at", desc=True)
            .execute()
        )
        guide_rows = response.data or []
        if not guide_rows:
            return []
        guide_ids = [row.get("id") for row in guide_rows if row.get("id")]

        # Load steps and progress in batches so the guide list can be rendered without extra API calls per guide.
        steps_by_guide: dict[str, list[dict]] = {guide_id: [] for guide_id in guide_ids}
        progress_by_guide: dict[str, dict[str, dict]] = {guide_id: {} for guide_id in guide_ids}
        steps_response = client.table("guide_steps").select("*").in_("guide_id", guide_ids).execute()
        for step_row in steps_response.data or []:
            guide_id = step_row.get("guide_id")
            if guide_id in steps_by_guide:
                steps_by_guide[guide_id].append(step_row)
        progress_response = (
            client.table("guide_step_progress")
            .select("guide_id, guide_step_id, is_complete, completed_at")
            .in_("guide_id", guide_ids)
            .eq("user_id", user_id)
            .execute()
        )
        for progress_row in progress_response.data or []:
            guide_id = progress_row.get("guide_id")
            step_id = progress_row.get("guide_step_id")
            if guide_id in progress_by_guide and step_id:
                progress_by_guide[guide_id][step_id] = progress_row
        guides: List[GuideEntry] = []
        for row in guide_rows:
            guide_id = row.get("id")
            step_rows = sorted(steps_by_guide.get(guide_id, []), key=lambda step: step.get("step_index") or 0)
            progress_map = progress_by_guide.get(guide_id, {})
            steps: List[GuideStepWithProgress] = []
            for step_row in step_rows:
                progress = progress_map.get(step_row.get("id"), {})
                steps.append(GuideStepWithProgress(**step_row, is_complete=bool(progress.get("is_complete", False)), completed_at=progress.get("completed_at")))
            guides.append(GuideEntry(**row, steps=steps))
        return guides

    # Fetch one guide entry without hydrating its steps.
    def get_guide(self, client: Client, guide_id: str) -> GuideEntry:
        response = client.table("guide_entries").select("*").eq("id", str(guide_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Guide entry not found")
        return GuideEntry(**response.data[0], steps=[])

    # Fetch one guide step by id.
    def get_guide_step(self, client: Client, step_id: str) -> GuideStep:
        response = client.table("guide_steps").select("*").eq("id", str(step_id)).limit(1).execute()
        if not response.data:
            raise KeyError("Guide step not found")
        return GuideStep(**response.data[0])

    # Generate a guide by proposing steps from source context and grounding each kept step with citations.
    def generate_guide(self, client: Client, user_id: str, payload: GuideGenerateRequest) -> Optional[GuideEntry]:
        hub_id = str(payload.hub_id)
        source_ids = [str(source_id) for source_id in payload.source_ids]
        if not source_ids:
            raise ValueError("Select at least one source to generate a guide.")
        step_count = payload.step_count or self.guide_default_steps
        step_count = max(1, min(int(step_count), 20))
        context_chunks: List[dict] = []
        for source_id in source_ids:
            context_chunks.extend(self._fetch_source_context(client, hub_id, source_id, self.guide_context_chunks_per_source))
        if not context_chunks:
            return None
        context_blocks = [
            f"Source {chunk.get('source_id')} [chunk {chunk.get('chunk_index')}]: {_trim_text(chunk.get('text') or '', 900)}"
            for chunk in context_chunks
        ]
        steps = self._generate_guide_steps(context_blocks, payload.topic, step_count)
        if not steps:
            return None
        now = datetime.now(timezone.utc).isoformat()
        batch_id = str(uuid.uuid4())
        topic = (payload.topic or "").strip() or None
        title = topic or "Onboarding Guide"
        topic_labels = self._safe_topic_labels_for_guide(title=title, topic=topic, step_payloads=steps)
        steps_payload: List[dict] = []
        kept_index = 1

        # Each proposed step is re-retrieved so only grounded instructions are stored.
        for step in steps:
            instruction = (step.get("instruction") or "").strip()
            if not instruction:
                continue
            step_title = (step.get("title") or "").strip() or None
            query_text = f"{step_title}. {instruction}" if step_title else instruction
            query_embedding = self._embed_query(query_text)
            raw_matches = self._match_chunks(client, hub_id, query_embedding, self.retrieval_candidate_pool, source_ids)
            matches = self._select_matches(raw_matches, query_embedding, self.guide_min_similarity, self.guide_max_citations, fallback_mode="guide")
            if not matches:
                continue
            citations: List[Citation] = []
            for match in matches:
                trimmed = _trim_text(match.get("text") or "", 600)
                citations.append(Citation(source_id=match["source_id"], snippet=trimmed, chunk_index=match.get("chunk_index")))
            confidence = _average_similarity(matches)
            steps_payload.append(
                {
                    "step_index": kept_index,
                    "title": step_title,
                    "instruction": instruction,
                    "citations": [citation.model_dump() for citation in citations],
                    "confidence": confidence,
                    "updated_at": now,
                }
            )
            kept_index += 1
        if not steps_payload:
            return None
        guide_row = (
            client.table("guide_entries")
            .insert(
                {
                    "hub_id": hub_id,
                    "title": title,
                    "topic": topic,
                    **self._build_topic_payload(topic_labels),
                    "summary": None,
                    "source_ids": source_ids,
                    "created_by": user_id,
                    "updated_by": user_id,
                    "updated_at": now,
                    "generation_batch_id": batch_id,
                }
            )
            .execute()
        )
        if not guide_row.data:
            return None
        guide_id = guide_row.data[0]["id"]
        for step in steps_payload:
            step["guide_id"] = guide_id
        steps_response = client.table("guide_steps").insert(steps_payload).execute()
        steps_out = [GuideStepWithProgress(**row, is_complete=False, completed_at=None) for row in steps_response.data]
        return GuideEntry(**guide_row.data[0], steps=steps_out)

    def update_guide(self, client: Client, guide_id: str, payload: dict) -> GuideEntry:
        if {"title", "topic", "summary"} & set(payload):
            existing = self.get_guide(client, guide_id)
            steps = self._fetch_guide_steps(client, guide_id)
            payload = {
                **payload,
                **self._build_topic_payload(
                    self._safe_topic_labels_for_guide(
                        title=payload.get("title", existing.title),
                        topic=payload.get("topic", existing.topic),
                        summary=payload.get("summary", existing.summary),
                        step_rows=steps,
                    )
                ),
            }
        response = client.table("guide_entries").update(payload).eq("id", str(guide_id)).execute()
        if not response.data:
            raise KeyError("Guide entry not found")
        return GuideEntry(**response.data[0], steps=[])

    def archive_guide(self, client: Client, guide_id: str, user_id: str) -> GuideEntry:
        now = datetime.now(timezone.utc).isoformat()
        response = client.table("guide_entries").update({"archived_at": now, "updated_at": now, "updated_by": user_id}).eq("id", str(guide_id)).execute()
        if not response.data:
            raise KeyError("Guide entry not found")
        return GuideEntry(**response.data[0], steps=[])

    def create_guide_step(self, client: Client, guide_id: str, payload: GuideStepCreateRequest) -> GuideStep:
        last_step = client.table("guide_steps").select("step_index").eq("guide_id", str(guide_id)).order("step_index", desc=True).limit(1).execute()
        next_index = 1
        if last_step.data:
            next_index = int(last_step.data[0].get("step_index") or 0) + 1
        row = (
            client.table("guide_steps")
            .insert(
                {
                    "guide_id": str(guide_id),
                    "step_index": next_index,
                    "title": payload.title,
                    "instruction": payload.instruction,
                    "citations": [],
                    "confidence": 0,
                }
            )
            .execute()
        )
        if not row.data:
            raise KeyError("Guide step not found")
        self._refresh_guide_topic_label(client, str(guide_id))
        return GuideStep(**row.data[0])

    def update_guide_step(self, client: Client, step_id: str, payload: dict) -> GuideStep:
        if "instruction" in payload:
            payload = {**payload, "citations": [], "confidence": 1.0}
        response = client.table("guide_steps").update(payload).eq("id", str(step_id)).execute()
        if not response.data:
            raise KeyError("Guide step not found")
        step = GuideStep(**response.data[0])
        self._refresh_guide_topic_label(client, step.guide_id)
        return step

    def reorder_guide_steps(self, client: Client, guide_id: str, ordered_step_ids: List[str]) -> List[GuideStep]:
        steps_response = client.table("guide_steps").select("id").eq("guide_id", str(guide_id)).execute()
        step_ids = [row.get("id") for row in steps_response.data]
        if set(step_ids) != set(ordered_step_ids):
            raise ValueError("Step list does not match current guide steps.")
        now = datetime.now(timezone.utc).isoformat()
        for index, step_id in enumerate(ordered_step_ids, start=1):
            client.table("guide_steps").update({"step_index": index, "updated_at": now}).eq("id", step_id).execute()
        updated = client.table("guide_steps").select("*").eq("guide_id", str(guide_id)).order("step_index").execute()
        return [GuideStep(**row) for row in updated.data]

    def upsert_guide_step_progress(
        self,
        client: Client,
        user_id: str,
        guide_id: str,
        step_id: str,
        payload: GuideStepProgressUpdate,
    ) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        completed_at = now if payload.is_complete else None
        progress_payload = {
            "guide_step_id": step_id,
            "guide_id": guide_id,
            "user_id": user_id,
            "is_complete": payload.is_complete,
            "completed_at": completed_at,
            "updated_at": now,
            "created_at": now,
        }
        response = client.table("guide_step_progress").upsert(progress_payload, on_conflict="guide_step_id,user_id").execute()
        if not response.data:
            raise KeyError("Guide step progress not found")
        return response.data[0]

    def _generate_faq_questions(self, context_blocks: List[str], count: int, existing_questions: Optional[List[str]] = None) -> List[str]:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Generate distinct FAQ questions "
            "grounded strictly in the provided context. Return a JSON array of strings only."
        )
        context = "\n".join(context_blocks)
        existing_block = ""
        if existing_questions:
            existing_list = "\n".join(f"- {q}" for q in existing_questions)
            existing_block = (
                f"\n\nExisting FAQs (do NOT repeat, rephrase, or ask similar questions):\n{existing_list}\n"
                "Focus on NEW topics, details, or angles not yet covered above."
            )
        user_prompt = (
            f"Context:\n{context}{existing_block}\n\n"
            f"Generate exactly {count} concise FAQ questions that an onboarding user would ask. "
            f"You MUST return {count} questions. Cover different topics from the context."
        )
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.4,
        )
        raw = completion.choices[0].message.content or ""
        return _parse_questions_from_text(raw, count)

    def _generate_faq_answer(self, question: str, context_blocks: List[str]) -> str:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Answer using only the provided context. "
            "Cite sources inline using [n] that match the context list."
        )
        user_prompt = f"Question: {question}\n\nContext:\n" + "\n".join(context_blocks)
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.2,
        )
        return completion.choices[0].message.content or ""

    def _generate_guide_steps(self, context_blocks: List[str], topic: Optional[str], step_count: int) -> List[Dict[str, str]]:
        system_prompt = (
            "You are Caddie, an onboarding assistant. Generate a concise, ordered checklist from the context. "
            "Return a JSON array of objects with keys: title (optional) and instruction. "
            "Use only information grounded in the provided context."
        )
        context = "\n".join(context_blocks)
        topic_text = f"Topic: {topic}\n" if topic else ""
        user_prompt = f"{topic_text}Context:\n{context}\n\nGenerate {step_count} checklist steps. Each step should be a clear instruction."
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0.2,
        )
        raw = completion.choices[0].message.content or ""
        return _parse_steps_from_text(raw, step_count)

    # Load guide steps in display order so downstream updates can re-derive topic labels.
    def _fetch_guide_steps(self, client: Client, guide_id: str) -> List[dict]:
        response = (
            client.table("guide_steps")
            .select("title, instruction")
            .eq("guide_id", str(guide_id))
            .order("step_index")
            .execute()
        )
        return response.data or []

    # Recompute and persist a guide topic label after edits that change the guide's content.
    def _refresh_guide_topic_label(self, client: Client, guide_id: str) -> None:
        guide = client.table("guide_entries").select("title, topic, summary").eq("id", str(guide_id)).limit(1).execute()
        if not guide.data:
            return
        row = guide.data[0]
        topic_labels = self._safe_topic_labels_for_guide(
            title=row.get("title"),
            topic=row.get("topic"),
            summary=row.get("summary"),
            step_rows=self._fetch_guide_steps(client, guide_id),
        )
        client.table("guide_entries").update(self._build_topic_payload(topic_labels)).eq("id", str(guide_id)).execute()

    # Persist the primary label alongside the full ranked list for compatibility with older reads.
    @staticmethod
    def _build_topic_payload(topic_labels: List[str]) -> dict:
        return {
            "topic_label": topic_labels[0] if topic_labels else None,
            "topic_labels": topic_labels,
        }

    # Build a short, ranked label list for FAQ text. Failures fall back to an empty list.
    def _safe_topic_labels_for_faq(self, question: Optional[str], answer: Optional[str]) -> List[str]:
        return self._safe_classify_topic_labels("\n".join(part for part in [question, answer] if part))

    # Compatibility shim for callers that still expect the original single-label helper.
    def _safe_topic_label_for_faq(self, question: Optional[str], answer: Optional[str]) -> Optional[str]:
        labels = self._safe_topic_labels_for_faq(question, answer)
        return labels[0] if labels else None

    # Build a short, ranked label list for a guide using the most useful available guide content.
    def _safe_topic_labels_for_guide(
        self,
        *,
        title: Optional[str],
        topic: Optional[str],
        summary: Optional[str] = None,
        step_rows: Optional[List[dict]] = None,
        step_payloads: Optional[List[Dict[str, str]]] = None,
    ) -> List[str]:
        title_or_topic_labels = self._derive_guide_labels_from_title_or_topic(topic=topic, title=title)
        explicit_topic_label = self._clean_guide_subject_phrase(topic)
        if explicit_topic_label:
            return [explicit_topic_label]
        if title_or_topic_labels:
            ai_sections: List[str] = []
            if title:
                ai_sections.append(f"Title: {title}")
            if summary:
                ai_sections.append(f"Summary: {summary}")
            for index, step in enumerate(step_rows or step_payloads or [], start=1):
                step_title = (step.get("title") or "").strip()
                instruction = (step.get("instruction") or "").strip()
                if not step_title and not instruction:
                    continue
                parts = [f"Step {index}:"]
                if step_title:
                    parts.append(step_title)
                if instruction:
                    parts.append(instruction)
                ai_sections.append(" ".join(parts))
            ai_labels = self._safe_classify_topic_labels("\n".join(ai_sections))
            merged: List[str] = []
            seen: set[str] = set()
            for label in [*title_or_topic_labels, *ai_labels]:
                key = label.lower()
                if key in seen:
                    continue
                merged.append(label)
                seen.add(key)
                if len(merged) >= 3:
                    break
            return merged
        sections: List[str] = []
        if title:
            sections.append(f"Title: {title}")
        if summary:
            sections.append(f"Summary: {summary}")
        for index, step in enumerate(step_rows or step_payloads or [], start=1):
            step_title = (step.get("title") or "").strip()
            instruction = (step.get("instruction") or "").strip()
            if not step_title and not instruction:
                continue
            parts = [f"Step {index}:"]
            if step_title:
                parts.append(step_title)
            if instruction:
                parts.append(instruction)
            sections.append(" ".join(parts))
        return self._safe_classify_topic_labels("\n".join(sections))

    # Prefer a clean subject phrase from guide topic/title before falling back to broader AI classification.
    def _derive_guide_labels_from_title_or_topic(self, *, topic: Optional[str], title: Optional[str]) -> List[str]:
        candidates = [topic, title]
        labels: List[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            label = self._clean_guide_subject_phrase(candidate)
            if not label:
                continue
            key = label.lower()
            if key in seen:
                continue
            labels.append(label)
            seen.add(key)
        return labels[:3]

    # Strip common guide boilerplate so titles like "guide to setting up a vector clock" become "Vector Clock".
    def _clean_guide_subject_phrase(self, raw: Optional[str]) -> Optional[str]:
        if raw is None:
            return None
        phrase = raw.strip()
        if not phrase:
            return None
        phrase = phrase.lower()
        phrase = re.sub(r"[^\w\s&/-]", " ", phrase)
        phrase = re.sub(
            r"^(guide\s+to|guide\s+for|guide|how\s+to|setting\s+up|setup|set\s+up|introduction\s+to|intro\s+to|mastering)\s+",
            "",
            phrase,
        )
        phrase = re.sub(
            r"^(guide\s+to|guide\s+for|guide|how\s+to|setting\s+up|setup|set\s+up|introduction\s+to|intro\s+to|mastering)\s+",
            "",
            phrase,
        )
        phrase = re.sub(r"\b(for|new|the|a|an)\b", " ", phrase)
        phrase = re.sub(r"\s+", " ", phrase).strip(" -/")
        if not phrase:
            return None
        generic_phrases = {
            "guide",
            "setup",
            "setting",
            "setting up",
            "programming",
            "guide to setting",
            "guide to setup",
        }
        if phrase in generic_phrases:
            return None
        return self._normalize_topic_label(phrase)

    # Ask the model for short topic labels, but never let classifier failures block content writes.
    def _safe_classify_topic_labels(self, content: str) -> List[str]:
        trimmed = _trim_text(content or "", 4000).strip()
        if not trimmed:
            return []
        try:
            return self._classify_topic_labels(trimmed)
        except Exception as exc:
            logger.warning("Topic label classification failed: %s", exc)
            return []

    # Normalize raw model output into a short Title Case label that can be shown in the UI.
    def _normalize_topic_label(self, raw: Optional[str]) -> Optional[str]:
        if raw is None:
            return None
        label = raw.strip()
        if not label:
            return None
        label = label.splitlines()[0]
        label = re.sub(r"^topic\s*:\s*", "", label, flags=re.IGNORECASE)
        label = label.strip("`'\"*[](){}:;,. ")
        label = re.sub(r"[/_|]+", " ", label)
        label = re.sub(r"\s+", " ", label).strip()
        if not label:
            return None
        words = label.split(" ")[:3]
        normalized_words: List[str] = []
        acronyms = {"hr": "HR", "it": "IT", "qa": "QA", "pto": "PTO", "sso": "SSO", "vpn": "VPN", "2fa": "2FA"}
        for word in words:
            cleaned = re.sub(r"[^A-Za-z0-9&-]", "", word)
            if not cleaned:
                continue
            normalized_words.append(acronyms.get(cleaned.lower(), cleaned.capitalize()))
        normalized = " ".join(normalized_words).strip()
        if not normalized:
            return None
        return normalized[:40].strip()

    # Parse raw classifier output into a ranked label list with duplicates removed.
    def _normalize_topic_labels(self, raw: Optional[str]) -> List[str]:
        if raw is None:
            return []
        labels: List[str] = []
        seen: set[str] = set()
        for part in re.split(r"[\n,;|]+", raw):
            normalized = self._normalize_topic_label(part)
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            labels.append(normalized)
            seen.add(key)
            if len(labels) >= 3:
                break
        return labels

    # Use the chat model to classify content into a short ranked label list such as HR, Security, IT Setup.
    def _classify_topic_labels(self, content: str) -> List[str]:
        system_prompt = (
            "You label onboarding content. Return the 3 most likely topic labels as a comma-separated list. "
            "Each label must be 1 to 3 words, Title Case, no quotes, no bullets, and no explanations."
        )
        user_prompt = (
            "Classify this content into the 3 most likely topic labels suitable for filter pills.\n\n"
            f"Content:\n{content}\n\n"
            "Return only the comma-separated labels."
        )
        completion = self.llm_client.chat.completions.create(
            model=self.chat_model,
            messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}],
            temperature=0,
        )
        raw = completion.choices[0].message.content or ""
        return self._normalize_topic_labels(raw)

    # Compatibility shim for older tests and call sites that still expect one label.
    def _classify_topic_label(self, content: str) -> Optional[str]:
        labels = self._classify_topic_labels(content)
        return labels[0] if labels else None
