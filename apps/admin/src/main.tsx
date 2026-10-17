import "@techaust/ui/fonts.css";
import "@techaust/ui/tokens.css";
import "./app.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { api, type User } from "./api.ts";
import { AcceptInvite, Home, SignIn } from "./auth.tsx";

// The invite token travels in the URL fragment (#t=…), which is never sent to servers or kept in logs.
const inviteToken = () => new URLSearchParams(location.hash.slice(1)).get("t");

function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api.me().then(
      (r) => setUser(r.user),
      () => setUser(null),
    );
  }, []);
  if (user === undefined) return <main className="card" aria-busy="true" />;
  if (user) return <Home user={user} onSignedOut={() => setUser(null)} />;
  const token = location.pathname === "/invite" ? inviteToken() : null;
  return token ? <AcceptInvite token={token} onSignedIn={setUser} /> : <SignIn onSignedIn={setUser} />;
}

const router = createBrowserRouter([{ path: "*", element: <App /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
