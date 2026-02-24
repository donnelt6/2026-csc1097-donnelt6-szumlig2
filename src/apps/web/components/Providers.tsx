'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthGate } from "./auth/AuthGate";
import { HubTabProvider } from "../lib/HubTabContext";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
  }));
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <HubTabProvider>{children}</HubTabProvider>
        </AuthGate>
      </QueryClientProvider>
    </AuthProvider>
  );
}
