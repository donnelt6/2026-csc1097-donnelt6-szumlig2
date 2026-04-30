'use client';

// page.tsx: Hubs list page with create-hub modal and hub management toolbar.

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useIsFetching, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowLeftIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { HubAppearanceModal } from "../../components/HubAppearanceModal";
import { HubsList } from "../../components/HubsList";
import { HubsToolbar, type HubsFilterState } from "../../components/HubsToolbar";
import { createHub } from "../../lib/api";
import {
  DEFAULT_HUB_COLOR_KEY,
  DEFAULT_HUB_ICON_KEY,
  type HubColorKey,
  type HubIconKey,
} from "../../lib/hubAppearance";
import { useSearch } from "../../lib/SearchContext";
import type { Hub } from "@shared/index";

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

  const { searchQuery, setSearchQuery } = useSearch();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedIconKey, setSelectedIconKey] = useState<HubIconKey>(DEFAULT_HUB_ICON_KEY);
  const [selectedColorKey, setSelectedColorKey] = useState<HubColorKey>(DEFAULT_HUB_COLOR_KEY);
  const [hubCount, setHubCount] = useState(0);
  const [paginationVisible, setPaginationVisible] = useState(false);
  const [filters, setFilters] = useState<HubsFilterState>({
    sortField: "accessed",
    sortDirection: "desc",
    selectedRoles: new Set(),
    typeTab: "all",
    statusTab: "active",
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description?: string; icon_key?: string; color_key?: string }) => createHub(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: ["hubs"] });
      const previousHubs = queryClient.getQueryData<Hub[]>(["hubs"]) ?? [];
      const tempId = `temp-hub-${Date.now()}`;
      const optimisticHub: Hub = {
        id: tempId,
        owner_id: "pending",
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        icon_key: payload.icon_key ?? DEFAULT_HUB_ICON_KEY,
        color_key: payload.color_key ?? DEFAULT_HUB_COLOR_KEY,
        created_at: new Date().toISOString(),
        archived_at: null,
        role: "owner",
        members_count: 1,
        sources_count: 0,
        last_accessed_at: new Date().toISOString(),
        is_favourite: false,
        member_emails: [],
        _isPendingClientSync: true,
      };
      queryClient.setQueryData<Hub[]>(["hubs"], (current = []) => [optimisticHub, ...current]);
      setCreateModalOpen(false);
      return { previousHubs, tempId };
    },
    onSuccess: (hub, _payload, context) => {
      queryClient.setQueryData<Hub[]>(["hubs"], (current = []) =>
        current.map((item) => (
          item.id === context?.tempId
            ? { ...hub, _isPendingClientSync: false }
            : item
        ))
      );
      setName("");
      setDescription("");
      setSelectedIconKey(DEFAULT_HUB_ICON_KEY);
      setSelectedColorKey(DEFAULT_HUB_COLOR_KEY);
    },
    onError: (_error, _payload, context) => {
      if (context?.previousHubs) {
        queryClient.setQueryData(["hubs"], context.previousHubs);
      }
      setCreateModalOpen(true);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["hubs"] });
    },
  });

  const onSubmit = (evt: React.FormEvent) => {
    evt.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      name,
      description,
      icon_key: selectedIconKey,
      color_key: selectedColorKey,
    });
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
      router.replace('/hubs', { scroll: false });
    }
  }, [searchParams, router]);

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
        <div className={`content-inner hubs-page${paginationVisible ? " hubs-page--with-pagination" : ""}`}>
          <div className="hubs-page-header">
            <div className="hubs-page-title-row">
              <div className="hubs-page-title-section">
                <Link href="/" className="hubs-page-back-link">
                  <ArrowLeftIcon className="hubs-page-back-link-icon" aria-hidden="true" />
                  <span>Back to Home</span>
                </Link>
                <h2 className="hubs-page-title">Your Hubs</h2>
                <p className="hubs-page-subtitle">
                  Manage your documentation environments and onboarding resources.
                </p>
              </div>
              <div className="hubs-mobile-search">
                <MagnifyingGlassIcon className="hubs-mobile-search-icon" />
                <input
                  type="text"
                  placeholder="Search documentation hubs..."
                  aria-label="Search documentation hubs"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="hubs-mobile-search-input"
                />
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
            onPaginationVisibleChange={setPaginationVisible}
            onCreateHub={() => setCreateModalOpen(true)}
          />
        </div>
      </main>
      {createModalOpen && (
        <HubAppearanceModal
          mode="create"
          title="Create a new hub"
          subtitle="Set up a new space for your documentation."
          submitLabel="Create hub"
          isSubmitting={createMutation.isPending}
          onClose={() => setCreateModalOpen(false)}
          onSubmit={onSubmit}
          name={name}
          description={description}
          onNameChange={setName}
          onDescriptionChange={setDescription}
          iconKey={selectedIconKey}
          colorKey={selectedColorKey}
          onIconKeyChange={setSelectedIconKey}
          onColorKeyChange={setSelectedColorKey}
          nameMax={NAME_MAX}
          descriptionMax={DESC_MAX}
        />
      )}
    </>
  );
}
