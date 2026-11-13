import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./auth.tsx";
import { Layout } from "./pages/Layout.tsx";
import { ActivityPage } from "./pages/ActivityPage.tsx";
import { AdminAuditPage } from "./pages/AdminAuditPage.tsx";
import { AdminPage } from "./pages/AdminPage.tsx";
import { CommonFieldsPage } from "./pages/CommonFieldsPage.tsx";
import { CompetitionsPage } from "./pages/CompetitionsPage.tsx";
import { EventDetailsPage } from "./pages/EventDetailsPage.tsx";
import { EventPage } from "./pages/EventPage.tsx";
import { GuidesPage } from "./pages/GuidesPage.tsx";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { OfficialsPage } from "./pages/OfficialsPage.tsx";
import { OrganizationPage } from "./pages/OrganizationPage.tsx";
import { OrganizationsPage } from "./pages/OrganizationsPage.tsx";
import { ProfilePage } from "./pages/ProfilePage.tsx";
import { NotFound } from "./pages/ErrorMessage.tsx";
import "./index.css";

// React Router in library (SPA) mode, not framework mode (ADR-0008).
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <OrganizationsPage /> },
      { path: "/organizations/:orgId", element: <OrganizationPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/me", element: <ProfilePage /> },
      // Sysadmins only (ADR-0032); anyone else gets a whole-page Not found from the API's 404.
      { path: "/admin", element: <AdminPage /> },
      { path: "/admin/audit", element: <AdminAuditPage /> },
      { path: "/events/:eventId", element: <EventPage /> },
      { path: "/events/:eventId/guides", element: <GuidesPage /> },
      { path: "/events/:eventId/details", element: <EventDetailsPage /> },
      {
        path: "/events/:eventId/common-fields",
        element: <CommonFieldsPage />,
      },
      { path: "/events/:eventId/officials", element: <OfficialsPage /> },
      {
        path: "/events/:eventId/competitions",
        element: <CompetitionsPage />,
      },
      {
        path: "/events/:eventId/activities/:activityId",
        element: <ActivityPage />,
      },
      // A saved or library Activity on its own (ADR-0031 item 6, #102 PR 5).
      { path: "/activities/:activityId", element: <ActivityPage /> },
      { path: "*", element: <NotFound /> },
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
