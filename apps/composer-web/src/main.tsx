import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./auth.tsx";
import { Layout } from "./pages/Layout.tsx";
import { EventPage } from "./pages/EventPage.tsx";
import { OrganizationPage } from "./pages/OrganizationPage.tsx";
import { OrganizationsPage } from "./pages/OrganizationsPage.tsx";

// React Router in library (SPA) mode, not framework mode (ADR-0008).
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <OrganizationsPage /> },
      { path: "/organizations/:orgId", element: <OrganizationPage /> },
      { path: "/events/:eventId", element: <EventPage /> },
      { path: "*", element: <p>Page not found.</p> },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
