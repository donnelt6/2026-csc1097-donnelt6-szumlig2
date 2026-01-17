'use client';

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthProvider } from "./auth/AuthProvider";
import { AuthGate } from "./auth/AuthGate";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate>{children}</AuthGate>
      </QueryClientProvider>
    </AuthProvider>
  );
}
