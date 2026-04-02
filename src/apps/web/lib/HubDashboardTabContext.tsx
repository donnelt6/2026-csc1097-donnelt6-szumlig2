'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useHubTab } from './HubTabContext';

export type HubDashboardTab = 'overview' | 'guides' | 'reminders' | 'faqs';

interface HubDashboardTabState {
  activeDashTab: HubDashboardTab;
  setActiveDashTab: (tab: HubDashboardTab) => void;
  /** Optional date to open in the reminders tab (consumed once) */
  pendingDate: Date | null;
  setPendingDate: (date: Date | null) => void;
}

const HubDashboardTabContext = createContext<HubDashboardTabState | null>(null);

export function HubDashboardTabProvider({ children }: { children: React.ReactNode }) {
  const { activeTab } = useHubTab();
  const [activeDashTab, setRaw] = useState<HubDashboardTab>('overview');
  const [pendingDate, setPendingDate] = useState<Date | null>(null);
  const setActiveDashTab = useCallback((tab: HubDashboardTab) => setRaw(tab), []);

  /* Reset to overview when leaving the dashboard sidebar tab */
  useEffect(() => {
    if (activeTab !== 'dashboard') {
      setRaw('overview');
      setPendingDate(null);
    }
  }, [activeTab]);

  return (
    <HubDashboardTabContext.Provider value={{ activeDashTab, setActiveDashTab, pendingDate, setPendingDate }}>
      {children}
    </HubDashboardTabContext.Provider>
  );
}

export function useHubDashboardTab(): HubDashboardTabState {
  const ctx = useContext(HubDashboardTabContext);
  if (!ctx) throw new Error('useHubDashboardTab must be used within HubDashboardTabProvider');
  return ctx;
}
