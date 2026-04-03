"""tracing.py: Records chat trace steps and optionally forwards them to Langfuse."""

from __future__ import annotations

import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, Optional

from ..core.config import get_settings

try:
    from langfuse import Langfuse
except ImportError:  # pragma: no cover - optional dependency
    Langfuse = None


# One recorded step within a traced chat request.
@dataclass
class TraceStep:
    name: str
    started_at: float
    input: Optional[Dict[str, Any]] = None
    output: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    duration_ms: Optional[float] = None


# Collects metadata and timed steps for one chat flow.
class ChatTraceRecorder:
    # Initialise tracing state and create the Langfuse client when tracing is enabled.
    def __init__(
        self,
        *,
        user_id: str,
        hub_id: str,
        session_id: Optional[str],
        question: str,
    ) -> None:
        settings = get_settings()
        self.user_id = str(user_id)
        self.hub_id = str(hub_id)
        self.session_id = str(session_id) if session_id else None
        self.question = question
        self.started_at = time.perf_counter()
        self.metadata: Dict[str, Any] = {}
        self.steps: list[TraceStep] = []
        self.enabled = bool(
            Langfuse
            and settings.langfuse_public_key
            and settings.langfuse_secret_key
        )
        self._client = None
        if self.enabled:
            self._client = Langfuse(
                public_key=settings.langfuse_public_key,
                secret_key=settings.langfuse_secret_key,
                host=settings.langfuse_host,
            )

    # Attach extra metadata that should be included with the trace.
    def annotate(self, **metadata: Any) -> None:
        for key, value in metadata.items():
            if value is not None:
                self.metadata[key] = value

    # Time one logical step of the chat pipeline and capture any error raised inside it.
    @contextmanager
    def step(self, name: str, **step_input: Any) -> Iterator[TraceStep]:
        step = TraceStep(name=name, started_at=time.perf_counter(), input=step_input or None)
        self.steps.append(step)
        try:
            yield step
        except Exception as exc:
            step.error = str(exc)
            raise
        finally:
            step.duration_ms = round((time.perf_counter() - step.started_at) * 1000, 2)

    # Send the finished trace to Langfuse when tracing is configured.
    def flush(self, *, output: Optional[Dict[str, Any]] = None) -> None:
        if not self.enabled or self._client is None:
            return
        payload = {
            "hub_id": self.hub_id,
            "session_id": self.session_id,
            **self.metadata,
            "steps": [
                {
                    "name": step.name,
                    "duration_ms": step.duration_ms,
                    "input": step.input,
                    "output": step.output,
                    "error": step.error,
                }
                for step in self.steps
            ],
            "total_duration_ms": round((time.perf_counter() - self.started_at) * 1000, 2),
        }
        self._client.trace(
            name="caddie.chat",
            user_id=self.user_id,
            session_id=self.session_id,
            input=self.question,
            output=output or {},
            metadata=payload,
        )
        flush = getattr(self._client, "flush", None)
        if callable(flush):
            flush()
