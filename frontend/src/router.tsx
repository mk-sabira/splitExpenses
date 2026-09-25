import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "./AppShell";
import { RedirectIfAuthenticated, RequireAuth } from "./auth/guards";
import { GroupPage } from "./group/GroupPage";
import { DesignPage } from "./pages/DesignPage";
import { GroupsPage } from "./pages/GroupsPage";
import { HelpPage } from "./pages/HelpPage";
import { JoinPage } from "./pages/JoinPage";
import { LandingPage } from "./pages/LandingPage";
import { NotFound, Placeholder } from "./pages/Placeholder";

// URLs match the links the backend puts in emails:
//   /join/:token (shareable link), /invites/:token (email invite), /groups/:groupId (reminders).
export const router = createBrowserRouter([
  // The front page has its own layout: the big wordmark replaces the app header.
  { path: "login", element: <RedirectIfAuthenticated><LandingPage mode="login" /></RedirectIfAuthenticated> },
  { path: "register", element: <RedirectIfAuthenticated><LandingPage mode="register" /></RedirectIfAuthenticated> },
  // Public pages inside the app layout: the style guide (dev builds only), and
  // the join link, which shows the group before asking anyone to log in.
  {
    element: <AppShell />,
    children: [
      { path: "join/:token", element: <JoinPage /> },
      ...(import.meta.env.DEV ? [{ path: "design", element: <DesignPage /> }] : []),
    ],
  },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/groups" replace /> },
      { path: "groups", element: <GroupsPage /> },
      { path: "groups/:groupId", element: <GroupPage /> },
      { path: "help", element: <HelpPage /> },
      { path: "groups/:groupId/expenses/:expenseId", element: <GroupPage /> },
      { path: "invites/:token", element: <Placeholder title="Accept an invite" /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);
