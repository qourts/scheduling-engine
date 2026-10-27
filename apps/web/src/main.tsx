import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { createWorkerRunner } from "./engine/workerRunner.js";
import { WorkspaceProvider } from "./state/workspace.js";
import { ConfirmProvider } from "./ui/confirm.js";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceProvider runner={createWorkerRunner()}>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </WorkspaceProvider>
  </StrictMode>,
);
