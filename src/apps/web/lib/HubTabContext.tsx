'use client';

import { createContext, useCallback, useContext, useState } from 'react';

export type HubTab = 'chat' | 'sources' | 'members' | 'reminders';

interface HubTabState {
  activeTab: HubTab;
  setActiveTab: (tab: HubTab) => void;
}

const HubTabContext = createContext<HubTabState>({
  activeTab: 'chat',
  setActiveTab: () => undefined,
});

export function HubTabProvider({ children }: { children: React.ReactNode }) {
  const [activeTab, setRaw] = useState<HubTab>('chat');
  const setActiveTab = useCallback((tab: HubTab) => setRaw(tab), []);
  return (
    <HubTabContext.Provider value={{ activeTab, setActiveTab }}>
      {children}
    </HubTabContext.Provider>
  );
}

export function useHubTab() {
  return useContext(HubTabContext);
}
