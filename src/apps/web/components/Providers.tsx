'use client';

// Providers.tsx: React Query and auth provider wrapper for the component tree.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthGate } from "./auth/AuthGate";
import { ThemeProvider } from "../lib/useTheme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
  }));
  return (
    <ThemeProvider>
      <AuthProvider>
        <QueryClientProvider client={queryClient}>
          <AuthGate>
            {children}
          </AuthGate>
        </QueryClientProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
