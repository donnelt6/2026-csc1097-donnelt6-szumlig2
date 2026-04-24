import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { HubDashboardTabProvider } from "../lib/HubDashboardTabContext";
import { HubTabProvider } from "../lib/HubTabContext";

export function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

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
