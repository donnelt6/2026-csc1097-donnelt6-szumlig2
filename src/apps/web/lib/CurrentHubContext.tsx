"use client";

import { createContext, useContext } from "react";
import type { Hub } from "./types";

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
