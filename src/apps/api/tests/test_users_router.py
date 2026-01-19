"""Router test for current-user endpoint."""


def test_get_me_returns_current_user(client) -> None:
    # Uses dependency override; expect user id/email in response.
    resp = client.get("/users/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "user-1"
    assert data["email"] == "user@example.com"
