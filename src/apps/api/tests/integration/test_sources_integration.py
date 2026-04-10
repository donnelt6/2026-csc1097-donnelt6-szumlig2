"""Integration tests that exercise source creation and queue routes through FastAPI."""

import pytest


pytestmark = pytest.mark.integration


def test_create_source_returns_upload_url_and_logs_activity(integration_client, integration_services) -> None:
    response = integration_client.post(
        "/sources",
        json={
            "hub_id": "11111111-1111-1111-1111-111111111111",
            "original_name": "Semester plan.txt",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["source"]["original_name"] == "Semester plan.txt"
    assert payload["source"]["status"] == "queued"
    assert payload["upload_url"] == "https://upload.test/44444444-4444-4444-4444-444444444444"
    assert integration_services.activity_log[-1]["action"] == "created"
    assert integration_services.activity_log[-1]["resource_type"] == "source"


def test_enqueue_source_queues_celery_task(integration_client, integration_services) -> None:
    response = integration_client.post("/sources/22222222-2222-2222-2222-222222222222/enqueue")

    assert response.status_code == 200
    assert response.json() == {"status": "queued"}
    assert integration_services.queued_tasks[-1] == {
        "task_name": "ingest_source",
        "args": [
            "22222222-2222-2222-2222-222222222222",
            "11111111-1111-1111-1111-111111111111",
            "11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/existing-notes.txt",
        ],
    }


def test_refresh_source_queues_web_ingestion(integration_client, integration_services) -> None:
    response = integration_client.post("/sources/33333333-3333-3333-3333-333333333333/refresh")

    assert response.status_code == 200
    assert response.json() == {"status": "queued"}
    assert integration_services.queued_tasks[-1] == {
        "task_name": "ingest_web_source",
        "args": [
            "33333333-3333-3333-3333-333333333333",
            "11111111-1111-1111-1111-111111111111",
            "https://example.com/docs",
            "11111111-1111-1111-1111-111111111111/33333333-3333-3333-3333-333333333333/web.md",
        ],
    }
