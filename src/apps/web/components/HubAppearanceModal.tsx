'use client';

import { useEffect, useRef } from "react";
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
  isSubmitDisabled?: boolean;
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
  isSubmitDisabled = false,
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
  const showTextFields = mode === "create" || mode === "edit";
  const formRef = useRef<HTMLFormElement | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal modal--hub-appearance"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget) {
            modalRef.current?.focus();
          }
        }}
        onKeyDown={(event) => {
          if (!showTextFields || event.key !== "Enter") return;
          const target = event.target as EventTarget | null;
          if (target instanceof HTMLTextAreaElement) return;
          event.preventDefault();
          formRef.current?.requestSubmit();
        }}
      >
        <div className="modal__header modal__header--appearance">
          <div className="modal__hero">
            <div className="modal__hero-preview">
              <div className="modal__icon-preview modal__icon-preview--lg" style={appearance.badgeStyle}>
                <PreviewIcon />
              </div>
              <div className="modal__hero-copy">
                {showTextFields ? (
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
                    {mode === "edit" && subtitle ? (
                      <p className="modal__subtitle">{subtitle}</p>
                    ) : null}
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

        <form ref={formRef} onSubmit={onSubmit}>
          {showTextFields && (
            <div className="hub-appearance-form-grid">
              <div>
                <div className="modal__field">
                  <span className="muted">Description</span>
                  <span className="modal__field-meta">
                    <span className="modal__optional">optional</span>
                    <span className="modal__char-count">{description.length}/{descriptionMax}</span>
                  </span>
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
            <span className="modal__picker-label">Customise appearance</span>

            <div className="hub-appearance-picker">
              <span className="hub-appearance-picker__label">Colour</span>
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
            </div>

            <div className="hub-appearance-picker">
              <span className="hub-appearance-picker__label">Icon</span>
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
                      <span className="hub-icon-tile__icon hub-icon-tile__icon--compact">
                        <Icon />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={`modal__footer modal__footer--split${showTextFields ? " modal__footer--centered" : ""}`}>
            <button
              className={`button button--secondary modal__footer-button${showTextFields ? " modal__footer-button--full modal__footer-button--create" : ""}`}
              type="submit"
              disabled={isSubmitting || isSubmitDisabled}
            >
              {isSubmitting ? (mode === "create" ? "Creating..." : "Saving...") : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
