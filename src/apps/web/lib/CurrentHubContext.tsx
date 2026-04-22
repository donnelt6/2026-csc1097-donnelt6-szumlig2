"use client";

// CurrentHubContext.tsx: React context providing the currently active hub to child components.

import { createContext, useContext } from "react";
import type { Hub } from "@shared/index";

interface CurrentHubContextValue {
  currentHub?: Hub | null;
  isLoading: boolean;
}

const CurrentHubContext = createContext<CurrentHubContextValue>({
  currentHub: null,
  isLoading: false,
});

export function CurrentHubProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: CurrentHubContextValue;
}) {
  return <CurrentHubContext.Provider value={value}>{children}</CurrentHubContext.Provider>;
}

export function useCurrentHub() {
  return useContext(CurrentHubContext);
}
