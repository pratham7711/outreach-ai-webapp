import React from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App code runs inside the QueryProvider mounted in app/layout.tsx. Components
 * that call useQuery need the same context under test. Retries are off so a
 * failed fetch surfaces immediately instead of stalling the test.
 */
export function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
