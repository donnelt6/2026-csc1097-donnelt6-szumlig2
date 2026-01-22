"""Unit tests for store source creation cleanup behavior."""

import uuid

import pytest

from app.schemas import SourceCreate
from app.services import store as store_module


class FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class FakeTable:
    def __init__(self, client: "FakeClient", name: str) -> None:
        self.client = client
        self.name = name
        self._payload: dict | None = None
        self._op: str | None = None
        self._filters: dict[str, str] = {}

    def insert(self, payload: dict) -> "FakeTable":
        self._op = "insert"
        self._payload = payload
        self.client.inserted.append((self.name, payload))
        return self

    def delete(self) -> "FakeTable":
        self._op = "delete"
        return self

    def eq(self, column: str, value: str) -> "FakeTable":
        self._filters[column] = value
        return self

    def execute(self) -> FakeResponse:
        if self._op == "insert":
            return FakeResponse([self._payload or {}])
        if self._op == "delete":
            self.client.deleted.append((self.name, dict(self._filters)))
            return FakeResponse([{"id": self._filters.get("id")}])
        return FakeResponse([{}])


class FakeClient:
    def __init__(self) -> None:
        self.inserted: list[tuple[str, dict]] = []
        self.deleted: list[tuple[str, dict[str, str]]] = []

    def table(self, name: str) -> FakeTable:
        return FakeTable(self, name)


def test_create_source_deletes_row_on_upload_url_failure(monkeypatch) -> None:
    fake_client = FakeClient()
    source_id = uuid.UUID("11111111-1111-1111-1111-111111111111")
    hub_id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")

    monkeypatch.setattr(store_module.uuid, "uuid4", lambda: source_id)

    def raise_upload_url(_path: str) -> str:
        raise RuntimeError("Failed to create signed upload URL")

    monkeypatch.setattr(store_module.store, "create_upload_url", raise_upload_url)

    payload = SourceCreate(hub_id=hub_id, original_name="doc.txt")

    with pytest.raises(RuntimeError):
        store_module.store.create_source(fake_client, payload)

    assert fake_client.deleted == [("sources", {"id": str(source_id)})]
