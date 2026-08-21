import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SiteSections from "./SiteSections";
import "./styles.css";
import "./theme.css";
import "./site-sections.css";
import "./fidelity.css";
import "./report-design.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <SiteSections />
  </StrictMode>,
);
