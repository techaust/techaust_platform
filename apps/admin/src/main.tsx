import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

// Scaffold only. Real screens arrive in M1.5 (admin auth) and later milestones.
function Placeholder() {
  return (
    <main>
      <h1>TecHaust Admin</h1>
      <p>Scaffold build. Nothing to see yet.</p>
    </main>
  );
}

const router = createBrowserRouter([{ path: "*", element: <Placeholder /> }]);

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
