import { StrictMode, Component } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { App } from "./app.tsx";
import { parseView, viewParams } from "./navigation.ts";
import "./style.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    /* No telemetry or location logging. */
  }
  override render(): ReactNode {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Something went wrong</h1>
        <p>Your link is still in the address bar. Reload to try again.</p>
        <button onClick={() => window.location.reload()}>Reload Tree Atlas</button>
      </main>
    ) : (
      this.props.children
    );
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } },
});
const rootRoute = createRootRoute({ component: Outlet });
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: (raw: Record<string, unknown>) => viewParams(parseView(raw)),
  component: App,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([route]),
  basepath: window.location.pathname,
  parseSearch: (raw) => Object.fromEntries(new URLSearchParams(raw)),
  stringifySearch: (raw) => {
    const params = new URLSearchParams(viewParams(parseView(raw))).toString();
    return `?${params}`;
  },
});
const root = document.getElementById("root");
if (root === null) throw new Error("Application mount point is missing.");
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
