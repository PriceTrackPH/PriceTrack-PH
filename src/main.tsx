import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SiteSections from "./SiteSections";
import "./styles.css";
import "./theme.css";
import "./site-sections.css";
import "./fidelity.css";
import "./report-design.css";
import "./legacy-sections.css";
import "./old-ui-exact.css";
import "./precision-fix.css";
import "./dark-report-fix.css";
import "./chart-focus-fix.css";
import "./hero-gradient-fix.css";
import "./variation-white-default.css";
import "./report-lavender-fix.css";
import "./title-fit";
import "./variation-display-format";
import "./affiliate-button";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <SiteSections />
  </StrictMode>,
);
