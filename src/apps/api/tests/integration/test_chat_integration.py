"""Integration tests that exercise chat routes through the full FastAPI app."""

import pytest


pytestmark = pytest.mark.integration


def test_chat_returns_seeded_answer_and_citation(integration_client, integration_services) -> None:
    response = integration_client.post(
        "/chat",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "scope": "hub",
            "question": "What does the seeded source say?",
            "source_ids": ["22222222-2222-2222-2222-222222222222"],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["answer"] == "Integration answer for: What does the seeded source say?"
    assert payload["citations"] == [
        {
            "source_id": "22222222-2222-2222-2222-222222222222",
            "snippet": "The seeded source contains the cited integration snippet.",
            "chunk_index": 0,
            "relevant_quotes": None,
            "paraphrased_quotes": None,
        }
    ]
    assert payload["session_title"] == "Integration session"
    assert integration_services.activity_log[-1]["action"] == "started"
    assert integration_services.activity_log[-1]["resource_type"] == "chat"
