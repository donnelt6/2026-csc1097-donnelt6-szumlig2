'use client';

// SettingsPageClient.tsx: User settings page with profile editing and preferences.

import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { ProfilePicker } from "../profile/ProfilePicker";
import { ThemeToggle } from "../navigation/ThemeToggle";
import { useAuth } from "../auth/AuthProvider";
import {
  buildProfileFormValue,
  isValidProfileMetadata,
  toProfileMetadata,
} from "../../lib/profile";
import { supabase } from "../../lib/supabaseClient";

export function SettingsPageClient() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [profileForm, setProfileForm] = useState(() => buildProfileFormValue(user ?? undefined));
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProfileForm(buildProfileFormValue(user ?? undefined));
  }, [user]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus(null);

    if (!supabase || !user) {
      setStatus("You need to be signed in to update your profile.");
      return;
    }

    const metadata = toProfileMetadata(profileForm);
    if (!isValidProfileMetadata(metadata)) {
      setStatus("Add your full name and choose a valid avatar before saving.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ data: metadata });
    setSaving(false);

    if (error) {
      setStatus(error.message || "We could not save your profile right now.");
      return;
    }

    await refreshUser();
    navigateBack(router);
  };

  return (
    <main className="page-content page-content--no-hero">
      <div className="content-inner settings-page">
        <div className="settings-page__header">
          <button className="hubs-page-back-link" type="button" onClick={() => navigateBack(router)}>
            <ArrowLeftIcon className="hubs-page-back-link-icon" />
            Back
          </button>
          <h1 className="dash-page-title">Profile settings</h1>
        </div>

        <form className="card settings-profile-builder" onSubmit={onSubmit}>
          <div className="modal__header modal__header--appearance">
            <div className="modal__hero">
              <div className="modal__hero-preview">
                <ProfileAvatar
                  className="settings-profile-builder__preview"
                  profile={{
                    email: user?.email,
                    full_name: profileForm.full_name,
                    avatar_mode: profileForm.avatar_mode,
                    avatar_key: profileForm.avatar_key,
                    avatar_color: profileForm.avatar_color,
                  }}
                  title="Profile preview"
                  ariaLabel="Profile preview"
                />
                <div className="modal__hero-copy settings-profile-builder__hero-copy">
                  <div className="hub-appearance-form-grid settings-profile-builder__fields">
                    <div>
                      <div className="modal__field">
                        <span className="muted">Name</span>
                      </div>
                      <input
                        aria-label="Full name"
                        value={profileForm.full_name}
                        onChange={(event) => setProfileForm((current) => ({ ...current, full_name: event.target.value }))}
                        type="text"
                        placeholder="Your full name"
                        required
                      />
                    </div>
                    <div>
                      <div className="modal__field">
                        <span className="muted">Email</span>
                      </div>
                      <input aria-label="Email" value={user?.email ?? ""} type="email" disabled />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <ProfilePicker value={profileForm} previewEmail={user?.email} onChange={setProfileForm} />

          {status && <p className="muted">{status}</p>}

          <div className="modal__footer modal__footer--split modal__footer--centered settings-profile-builder__actions">
            <button className="button button--secondary modal__footer-button modal__footer-button--full modal__footer-button--create" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button className="button button--secondary" type="button" onClick={() => navigateBack(router)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>

        <section className="card settings-appearance">
          <div className="settings-appearance__header">
            <h2 className="settings-appearance__title">Appearance</h2>
            <p className="settings-appearance__description">Switch between light and dark mode.</p>
          </div>
          <ThemeToggle />
        </section>
      </div>
    </main>
  );
}

function navigateBack(router: ReturnType<typeof useRouter>) {
  if (typeof window !== "undefined" && window.history.length > 1) {
    router.back();
    return;
  }
  router.push("/");
}
