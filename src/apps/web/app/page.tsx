'use client';

import { useEffect, useRef, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { HubsList } from "../components/HubsList";
import { InvitesPanel } from "../components/InvitesPanel";

const MIN_HUBS_LOADING_MS = 1500;
const LOADING_FADE_MS = 240;

export default function HomePage() {
  const queryClient = useQueryClient();
  const hubsFetching = useIsFetching({ queryKey: ["hubs"] });
  const [minDelayElapsed, setMinDelayElapsed] = useState(true);
  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [navHeight, setNavHeight] = useState(0);
  const hubsLoaded = queryClient.getQueryData(["hubs"]) !== undefined;
  const isInitialHubsLoading = hubsFetching > 0 && !hubsLoaded;
  const [overlayRendered, setOverlayRendered] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

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
    const nav = document.querySelector<HTMLElement>(".site-nav");
    if (!nav) return;
    const update = () => setNavHeight(nav.getBoundingClientRect().height);
    update();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(update);
      observer.observe(nav);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
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

  return (
    <main className="page grid" style={{ gap: "24px", position: "relative" }}>
      {overlayRendered && (
        <div
          className={`loading-overlay${overlayVisible ? " is-visible" : ""}`}
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{ top: navHeight }}
        >
          <div className="loading-card">
            <span className="loading-spinner" aria-hidden="true" />
            <p className="loading-text">Loading your hubs...</p>
          </div>
        </div>
      )}
      <header className="grid card">
        <h1 style={{ margin: 0 }}>Caddie</h1>
        <p className="muted">
          Upload your onboarding docs, process them into embeddings, and chat with cited answers. Start by creating a hub,
          then upload a file and ask a question.
        </p>
      </header>
      <InvitesPanel />
      <HubsList />
    </main>
  );
}
