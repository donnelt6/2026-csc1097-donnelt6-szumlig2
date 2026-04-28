import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { HubDashboardTabProvider } from "../lib/HubDashboardTabContext";
import { HubTabProvider } from "../lib/HubTabContext";

const testQueryClients = new Set<QueryClient>();

export function cleanupTestQueryClients() {
  for (const queryClient of testQueryClients) {
    // Cancel in-flight work so polling queries cannot outlive the test that created them.
    void queryClient.cancelQueries(undefined, { silent: true });
    queryClient.clear();
  }
  testQueryClients.clear();
}

export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Test query clients should not schedule cache-GC timers that keep Vitest alive.
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  testQueryClients.add(queryClient);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <HubTabProvider>
          <HubDashboardTabProvider>{children}</HubDashboardTabProvider>
        </HubTabProvider>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper });
  return { ...result, queryClient };
}
