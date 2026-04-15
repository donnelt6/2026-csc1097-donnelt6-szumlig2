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
        return GuideStep(**row.data[0])

    def update_guide_step(self, client: Client, step_id: str, payload: dict) -> GuideStep:
        if "instruction" in payload:
            payload = {**payload, "citations": [], "confidence": 1.0}
        response = client.table("guide_steps").update(payload).eq("id", str(step_id)).execute()
        if not response.data:
            raise KeyError("Guide step not found")
        return GuideStep(**response.data[0])

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
