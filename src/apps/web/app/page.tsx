'use client';

import { useState, useRef, useEffect } from "react";
import { useIsFetching, useQueryClient, useMutation } from "@tanstack/react-query";
import { PlusIcon } from "@heroicons/react/24/outline";
import { PageHero } from "../components/PageHero";
import { HubsList } from "../components/HubsList";
import { HubsToolbar, type HubsFilterState } from "../components/HubsToolbar";
import { createHub } from "../lib/api";

const MIN_HUBS_LOADING_MS = 1500;
const LOADING_FADE_MS = 0;

export default function HomePage() {
  const queryClient = useQueryClient();
  const hubsFetching = useIsFetching({ queryKey: ["hubs"] });
  const [minDelayElapsed, setMinDelayElapsed] = useState(true);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hubsLoaded = queryClient.getQueryData(["hubs"]) !== undefined;
  const isInitialHubsLoading = hubsFetching > 0 && !hubsLoaded;
  const [overlayRendered, setOverlayRendered] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createMenuRef = useRef<HTMLDetailsElement>(null);
  const [hubCount, setHubCount] = useState(0);
  const [filters, setFilters] = useState<HubsFilterState>({
    sortField: "accessed",
    sortDirection: "desc",
    selectedRoles: new Set(),
    minMembers: "",
    maxMembers: "",
    minSources: "",
    maxSources: "",
    showOnlyFavourites: false,
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string }) => createHub(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
      setName("");
      setDescription("");
      if (createMenuRef.current) {
        createMenuRef.current.open = false;
      }
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
    const handleClickOutside = (event: MouseEvent) => {
      if (createMenuRef.current && !createMenuRef.current.contains(event.target as Node)) {
        createMenuRef.current.open = false;
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

      <PageHero
        title="Your Hubs"
        subtitle="Upload your onboarding docs, process them into embeddings, and chat with cited answers."
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search hubs..."
        toolbar={
          <HubsToolbar
            filters={filters}
            onFiltersChange={setFilters}
            hubCount={hubCount}
          />
        }
        action={
          <details className="create-hub-menu" ref={createMenuRef}>
            <summary className="create-hub-trigger">
              <PlusIcon style={{ width: 18, height: 18 }} />
              Create hub
            </summary>
            <div className="create-hub-dropdown">
              <form onSubmit={onSubmit} className="grid">
                <label>
                  <span className="muted">Hub name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Onboarding hub"
                  />
                </label>
                <label>
                  <span className="muted">Description (optional)</span>
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this hub for?"
                  />
                </label>
                <button className="button button--primary" type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating..." : "Create hub"}
                </button>
              </form>
            </div>
          </details>
        }
      />

      <main className="page-content">
        <div className="content-inner">
          <HubsList
            searchQuery={searchQuery}
            filters={filters}
            onHubCountChange={setHubCount}
          />
        </div>
      </main>
    </>
  );
}
