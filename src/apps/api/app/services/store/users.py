"""UserStoreMixin: resolves auth users into lightweight profile and label data."""

from typing import Any, Dict, List

from ...schemas import UserProfileSummary
from .base import logger


class UserStoreMixin:
    # Map a set of user ids to the best display label available for each user.
    def _resolve_user_labels_by_ids(self, user_ids: set[str]) -> Dict[str, str]:
        if not user_ids:
            return {}
        profile_lookup = self.resolve_user_profiles_by_ids(user_ids)
        return {user_id: profile.display_name or profile.email or user_id for user_id, profile in profile_lookup.items()}

    # Resolve user ids through the auth admin API and return normalized profile summaries.
    def resolve_user_profiles_by_ids(self, user_ids: set[str]) -> Dict[str, UserProfileSummary]:
        if not user_ids:
            return {}
        profile_lookup: Dict[str, UserProfileSummary] = {}
        remaining = set(user_ids)
        page = 1
        per_page = 100
        try:
            while remaining:
                try:
                    response = self.service_client.auth.admin.list_users(page=page, per_page=per_page)
                except TypeError:
                    # Some client versions do not support pagination arguments, so fall back to the legacy call shape.
                    response = self.service_client.auth.admin.list_users()
                    users = self._extract_admin_users(response)
                    for user in users:
                        user_id = str(getattr(user, "id", "") or "")
                        if user_id not in remaining:
                            continue
                        profile_lookup[user_id] = self._profile_summary_for_user(user, user_id)
                        remaining.discard(user_id)
                    break
                users = self._extract_admin_users(response)
                if not users:
                    break
                for user in users:
                    user_id = str(getattr(user, "id", "") or "")
                    if user_id not in remaining:
                        continue
                    profile_lookup[user_id] = self._profile_summary_for_user(user, user_id)
                    remaining.discard(user_id)
                if len(users) < per_page:
                    break
                page += 1
        except Exception:
            logger.exception("Failed to resolve user profiles by id", extra={"user_id_count": len(user_ids)})
            return {}
        return profile_lookup

    # Normalize the different list-users response shapes returned by various auth client versions.
    @staticmethod
    def _extract_admin_users(response: Any) -> List[Any]:
        if isinstance(response, list):
            return response
        if hasattr(response, "users"):
            return list(getattr(response, "users") or [])
        data = getattr(response, "data", None)
        if isinstance(data, list):
            return data
        if hasattr(data, "users"):
            return list(getattr(data, "users") or [])
        if isinstance(data, dict):
            users = data.get("users")
            if isinstance(users, list):
                return users
        return []

    # Return a single display label for a user object when only a string label is needed.
    @staticmethod
    def _display_label_for_user(user: Any, fallback: str) -> str:
        profile = UserStoreMixin._profile_summary_for_user(user, fallback)
        return profile.display_name or profile.email or fallback

    # Convert an auth admin user object into the API's normalized profile summary shape.
    @staticmethod
    def _profile_summary_for_user(user: Any, fallback: str) -> UserProfileSummary:
        metadata = getattr(user, "user_metadata", None) or {}
        full_name = (metadata.get("full_name") or "").strip() if isinstance(metadata, dict) else ""
        email = getattr(user, "email", None) or ""
        avatar_mode = (metadata.get("avatar_mode") or "").strip() if isinstance(metadata, dict) else ""
        avatar_key = (metadata.get("avatar_key") or "").strip() if isinstance(metadata, dict) else ""
        avatar_color = (metadata.get("avatar_color") or "").strip() if isinstance(metadata, dict) else ""
        return UserProfileSummary(
            user_id=str(getattr(user, "id", "") or fallback),
            email=email or None,
            display_name=full_name or email or fallback,
            avatar_mode=avatar_mode or None,
            avatar_key=avatar_key or None,
            avatar_color=avatar_color or None,
        )
