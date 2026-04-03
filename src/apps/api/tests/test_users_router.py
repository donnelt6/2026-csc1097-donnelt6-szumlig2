"""Router test for current-user endpoint."""


# Verifies that the current user endpoint returns the authenticated user payload.
# Endpoint behavior tests.
def test_get_me_returns_current_user(client) -> None:

    # Uses dependency override; expect user id/email in response.
    resp = client.get("/users/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "00000000-0000-0000-0000-000000000001"
    assert data["email"] == "user@example.com"
