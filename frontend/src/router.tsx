import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./AppShell";
import { DesignPage } from "./pages/DesignPage";
import { LandingPage } from "./pages/LandingPage";
import { NotFound, Placeholder } from "./pages/Placeholder";

// URLs match the links the backend puts in emails:
//   /join/:token (shareable link), /invites/:token (email invite), /groups/:groupId (reminders).
export const router = createBrowserRouter([
  // The front page has its own layout: the big wordmark replaces the app header.
  { path: "login", element: <LandingPage mode="login" /> },
  { path: "register", element: <LandingPage mode="register" /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/groups" replace /> },
      { path: "groups", element: <Placeholder title="My groups" /> },
      { path: "groups/:groupId", element: <Placeholder title="Group" /> },
      { path: "groups/:groupId/expenses/:expenseId", element: <Placeholder title="Expense" /> },
      { path: "join/:token", element: <Placeholder title="Join a group" /> },
      { path: "invites/:token", element: <Placeholder title="Accept an invite" /> },
      // Living style guide for reviewing the design system; dev builds only.
      ...(import.meta.env.DEV ? [{ path: "design", element: <DesignPage /> }] : []),
      { path: "*", element: <NotFound /> },
    ],
  },
]);
