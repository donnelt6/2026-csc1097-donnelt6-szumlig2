"""test_schemas.py: Contains API tests for schemas."""
import pytest

from pydantic import ValidationError

from app.schemas import ChatSessionRenameRequest, CreateRevisionRequest, HubUpdate


# Verifies that hub update rejects blank name.
# Schema validation tests.
def test_hub_update_rejects_blank_name() -> None:

    with pytest.raises(ValidationError):
        HubUpdate(name="   ")


# Verifies that hub update trims name.
def test_hub_update_trims_name() -> None:
    payload = HubUpdate(name="  Valid  ")
    assert payload.name == "Valid"


# Verifies that chat session rename rejects blank title.
def test_chat_session_rename_rejects_blank_title() -> None:
    with pytest.raises(ValidationError):
        ChatSessionRenameRequest(title="   ")


# Verifies that chat session rename trims title.
def test_chat_session_rename_trims_title() -> None:
    payload = ChatSessionRenameRequest(title="  Title  ")
    assert payload.title == "Title"


# Verifies that create revision rejects blank content.
def test_create_revision_rejects_blank_content() -> None:
    with pytest.raises(ValidationError):
        CreateRevisionRequest(content="   ")


# Verifies that create revision trims content.
def test_create_revision_trims_content() -> None:
    payload = CreateRevisionRequest(content="  Updated answer  ")
    assert payload.content == "Updated answer"
