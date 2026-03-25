import pytest
from pydantic import ValidationError

from app.schemas import ChatSessionRenameRequest, HubUpdate


def test_hub_update_rejects_blank_name() -> None:
    with pytest.raises(ValidationError):
        HubUpdate(name="   ")


def test_hub_update_trims_name() -> None:
    payload = HubUpdate(name="  Valid  ")
    assert payload.name == "Valid"


def test_chat_session_rename_rejects_blank_title() -> None:
    with pytest.raises(ValidationError):
        ChatSessionRenameRequest(title="   ")


def test_chat_session_rename_trims_title() -> None:
    payload = ChatSessionRenameRequest(title="  Title  ")
    assert payload.title == "Title"
