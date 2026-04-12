'use client';

// HubTabContext.tsx: Tab state context for the hub detail page.

import { createContext, useCallback, useContext, useState } from 'react';

export type HubTab = 'chat' | 'sources' | 'dashboard' | 'members' | 'admin';

interface HubTabState {
  activeTab: HubTab;
  setActiveTab: (tab: HubTab) => void;
}

const HubTabContext = createContext<HubTabState | null>(null);

export function HubTabProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setRaw] = useState<HubTab>('chat');
  const setActiveTab = useCallback((tab: HubTab) => setRaw(tab), []);
  return (
    <HubTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </HubTabContext.Provider>
  );
}

export function useHubTab(): HubTabState {
  const ctx = useContext(HubTabContext);
  if (!ctx) throw new Error('useHubTab must be used within HubTabProvider');
  return ctx;
}
