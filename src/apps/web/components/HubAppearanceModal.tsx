'use client';

import { useEffect, useState } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  DEFAULT_HUB_COLOR_KEY,
  DEFAULT_HUB_ICON_KEY,
  HUB_COLOR_OPTIONS,
  HUB_ICON_OPTIONS,
  resolveHubAppearance,
  type HubColorKey,
  type HubIconKey,
} from "../lib/hubAppearance";

interface HubAppearanceModalProps {
  mode: "create" | "edit";
  title: string;
  subtitle: string;
  submitLabel: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (evt: React.FormEvent<HTMLFormElement>) => void;
  name?: string;
  description?: string;
  onNameChange?: (value: string) => void;
  onDescriptionChange?: (value: string) => void;
  iconKey: HubIconKey;
  colorKey: HubColorKey;
  onIconKeyChange: (value: HubIconKey) => void;
  onColorKeyChange: (value: HubColorKey) => void;
  nameMax?: number;
  descriptionMax?: number;
}

export function HubAppearanceModal({
  mode,
  title,
  subtitle,
  submitLabel,
  isSubmitting = false,
  onClose,
  onSubmit,
  name = "",
  description = "",
  onNameChange,
  onDescriptionChange,
  iconKey,
  colorKey,
  onIconKeyChange,
  onColorKeyChange,
  nameMax = 40,
  descriptionMax = 200,
}: HubAppearanceModalProps) {
  const appearance = resolveHubAppearance(iconKey ?? DEFAULT_HUB_ICON_KEY, colorKey ?? DEFAULT_HUB_COLOR_KEY);
  const PreviewIcon = appearance.icon.icon;
  const showTextFields = mode === "create";
  const [appearancePanel, setAppearancePanel] = useState<"icon" | "color">("icon");

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--hub-appearance" onClick={(event) => event.stopPropagation()}>
        <div className="modal__header modal__header--appearance">
          <div className="modal__hero">
            <div className="modal__hero-preview">
              <div className="modal__icon-preview modal__icon-preview--lg" style={appearance.badgeStyle}>
                <PreviewIcon />
              </div>
              <div className="modal__hero-copy">
                {mode === "create" ? (
                  <div className="modal__editable-title-wrap">
                    <input
                      id="hub-create-title"
                      className="modal__editable-title"
                      value={name}
                      onChange={(event) => onNameChange?.(event.target.value)}
                      placeholder="Name your hub"
                      maxLength={nameMax}
                      autoFocus
                      aria-label="Hub title"
                    />
                  </div>
                ) : (
                  <>
                    <h3 className="modal__title">{title}</h3>
                    <p className="modal__subtitle">{subtitle}</p>
                  </>
                )}
              </div>
            </div>
            <button className="modal__close" onClick={onClose} type="button" aria-label="Close modal">
              <XMarkIcon style={{ width: 20, height: 20 }} />
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit}>
          {showTextFields && (
            <div className="hub-appearance-form-grid">
              <div>
                <div className="modal__field">
                  <span className="muted">Description <span className="modal__optional">optional</span></span>
                  <span className="modal__char-count">{description.length}/{descriptionMax}</span>
                </div>
                <textarea
                  value={description}
                  onChange={(event) => onDescriptionChange?.(event.target.value)}
                  placeholder="What is this hub for?"
                  maxLength={descriptionMax}
                  rows={3}
                />
              </div>
            </div>
          )}

          <div className="hub-appearance-section hub-appearance-section--compact">
            <div className="hub-appearance-section__bar">
              <span className="modal__picker-label">Customise appearance</span>
              <div className="hubs-toolbar-tabs" role="tablist" aria-label="Customise appearance">
                <button
                  type="button"
                  className={`hubs-tab${appearancePanel === "icon" ? " hubs-tab--active" : ""}`}
                  onClick={() => setAppearancePanel("icon")}
                  role="tab"
                  aria-selected={appearancePanel === "icon"}
                >
                  Icon
                </button>
                <button
                  type="button"
                  className={`hubs-tab${appearancePanel === "color" ? " hubs-tab--active" : ""}`}
                  onClick={() => setAppearancePanel("color")}
                  role="tab"
                  aria-selected={appearancePanel === "color"}
                >
                  Color
                </button>
              </div>
            </div>

            {appearancePanel === "icon" ? (
              <div className="hub-icon-grid hub-icon-grid--compact">
                {HUB_ICON_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  const active = option.key === iconKey;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`hub-icon-tile hub-icon-tile--compact${active ? " hub-icon-tile--active" : ""}`}
                      onClick={() => onIconKeyChange(option.key)}
                      aria-pressed={active}
                      aria-label={`Select ${option.label} icon`}
                    >
                      <span className="hub-icon-tile__icon hub-icon-tile__icon--compact" style={active ? appearance.previewStyle : undefined}>
                        <Icon />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="hub-color-grid hub-color-grid--compact">
                {HUB_COLOR_OPTIONS.map((option) => {
                  const active = option.key === colorKey;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`hub-color-tile hub-color-tile--compact${active ? " hub-color-tile--active" : ""}`}
                      onClick={() => onColorKeyChange(option.key)}
                      aria-pressed={active}
                      aria-label={`Select ${option.label} color`}
                      style={{ ["--hub-color-outline" as string]: option.value }}
                    >
                      <span className="hub-color-tile__swatch hub-color-tile__swatch--compact" style={{ backgroundColor: option.value }}>
                        {active ? <span className="hub-color-tile__check" aria-hidden="true" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="modal__footer modal__footer--split">
            <button className="button button--secondary modal__footer-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? (mode === "create" ? "Creating..." : "Saving...") : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
