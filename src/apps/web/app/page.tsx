'use client';

import { useState, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useIsFetching, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  XMarkIcon,
  RectangleStackIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  BeakerIcon,
} from "@heroicons/react/24/outline";
import { HubsList } from "../components/HubsList";
import { HubsToolbar, type HubsFilterState } from "../components/HubsToolbar";
import { createHub } from "../lib/api";
import { useSearch } from "../lib/SearchContext";

const HUB_ICONS = [
  RectangleStackIcon,
  BookOpenIcon,
  ChatBubbleLeftRightIcon,
  AcademicCapIcon,
  BriefcaseIcon,
  BeakerIcon,
];

const HUB_COLORS = [
  "#8b5cf6",
  "#06b6d4",
  "#3b82f6",
  "#ef4444",
  "#f97316",
  "#eab308",
];

const NAME_MAX = 40;
const DESC_MAX = 200;

const MIN_HUBS_LOADING_MS = 1500;
const LOADING_FADE_MS = 0;

export default function HomePage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const hubsFetching = useIsFetching({ queryKey: ["hubs"] });
  const [minDelayElapsed, setMinDelayElapsed] = useState(true);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hubsLoaded = queryClient.getQueryData(["hubs"]) !== undefined;
  const isInitialHubsLoading = hubsFetching > 0 && !hubsLoaded;
  const [overlayRendered, setOverlayRendered] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const { searchQuery } = useSearch();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState(0);
  const [selectedColor, setSelectedColor] = useState(0);
  const [hubCount, setHubCount] = useState(0);
  const [filters, setFilters] = useState<HubsFilterState>({
    sortField: "accessed",
    sortDirection: "desc",
    selectedRoles: new Set(),
    typeTab: "all",
    statusTab: "all",
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string }) => createHub(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
      setName("");
      setDescription("");
      setSelectedIcon(0);
      setSelectedColor(0);
      setCreateModalOpen(false);
    },
  });

  const onSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({ name, description });
  };

  useEffect(() => {
    if (isInitialHubsLoading) {
      if (!delayTimerRef.current) {
        setMinDelayElapsed(false);
        delayTimerRef.current = setTimeout(() => {
          setMinDelayElapsed(true);
          delayTimerRef.current = null;
        }, MIN_HUBS_LOADING_MS);
      }
      return;
    }
    if (!delayTimerRef.current) {
      setMinDelayElapsed(true);
    }
  }, [isInitialHubsLoading]);

  useEffect(() => {
    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!overlayRendered) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [overlayRendered]);

  const showLoadingScreen = isInitialHubsLoading || !minDelayElapsed;

  useEffect(() => {
    if (showLoadingScreen) {
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
      setOverlayRendered(true);
      setOverlayVisible(true);
      return;
    }
    if (!overlayRendered) return;
    setOverlayVisible(false);
    exitTimerRef.current = setTimeout(() => {
      setOverlayRendered(false);
      exitTimerRef.current = null;
    }, LOADING_FADE_MS);
  }, [showLoadingScreen, overlayRendered]);

  useEffect(() => {
    if (searchParams.get('create') === 'true') {
      setCreateModalOpen(true);
      router.replace('/', { scroll: false });
    }
  }, [searchParams, router]);

  useEffect(() => {
    if (!createModalOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCreateModalOpen(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [createModalOpen]);

  return (
    <>
      {overlayRendered && (
        <div
          className={`loading-overlay${overlayVisible ? " is-visible" : ""}`}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="loading-card">
            <span className="loading-spinner" aria-hidden="true" />
            <p className="loading-text">Loading your hubs...</p>
          </div>
        </div>
      )}

      <main className="page-content page-content--hubs">
        <div className="content-inner hubs-page">
          <div className="hubs-page-header">
            <div className="hubs-page-title-row">
              <div className="hubs-page-title-section">
                <h2 className="hubs-page-title">Your Hubs</h2>
                <p className="hubs-page-subtitle">
                  Manage your documentation environments and onboarding resources.
                </p>
              </div>
              <HubsToolbar
                filters={filters}
                onFiltersChange={setFilters}
                hubCount={hubCount}
              />
            </div>
          </div>

          <HubsList
            searchQuery={searchQuery}
            filters={filters}
            onHubCountChange={setHubCount}
            onCreateHub={() => setCreateModalOpen(true)}
          />
        </div>
      </main>

      {createModalOpen && (() => {
        const IconPreview = HUB_ICONS[selectedIcon];
        return (
          <div className="modal-backdrop" onClick={() => setCreateModalOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal__header">
                <div className="modal__icon-preview" style={{ background: HUB_COLORS[selectedColor] }}>
                  <IconPreview style={{ width: 24, height: 24 }} />
                </div>
                <button className="modal__close" onClick={() => setCreateModalOpen(false)}>
                  <XMarkIcon style={{ width: 20, height: 20 }} />
                </button>
              </div>

              <h3 className="modal__title">Create a new hub</h3>
              <p className="modal__subtitle">A space for your docs, embeddings, and AI chat.</p>

              <div className="modal__pickers">
                <div className="modal__picker-group">
                  <span className="modal__picker-label">Icon</span>
                  <div className="modal__picker-row">
                    {HUB_ICONS.map((Icon, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`modal__icon-option${i === selectedIcon ? " modal__icon-option--active" : ""}`}
                        onClick={() => setSelectedIcon(i)}
                      >
                        <Icon style={{ width: 18, height: 18 }} />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="modal__picker-group">
                  <span className="modal__picker-label">Color</span>
                  <div className="modal__picker-row">
                    {HUB_COLORS.map((color, i) => (
                      <button
                        key={i}
                        type="button"
                        className={`modal__color-option${i === selectedColor ? " modal__color-option--active" : ""}`}
                        style={{ background: color }}
                        onClick={() => setSelectedColor(i)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <form onSubmit={onSubmit}>
                <div className="modal__field">
                  <span className="muted">Hub name</span>
                  <span className="modal__char-count">{name.length}/{NAME_MAX}</span>
                </div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Onboarding hub"
                  maxLength={NAME_MAX}
                  autoFocus
                />

                <div className="modal__field">
                  <span className="muted">Description <span className="modal__optional">optional</span></span>
                  <span className="modal__char-count">{description.length}/{DESC_MAX}</span>
                </div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this hub for?"
                  maxLength={DESC_MAX}
                  rows={3}
                />

                <div className="modal__footer">
                  <button className="button button--primary" type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? "Creating..." : "Create hub"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}
    </>
  );
}
