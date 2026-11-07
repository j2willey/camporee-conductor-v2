import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { OfficialApp } from "./OfficialApp.tsx";

// Two pages, one app: the judge page at /, the Official view at /official (#40 PR 3). The Collator sends
// index.html for both.
const isOfficial = /^\/official(\/|$)/.test(window.location.pathname);

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>{isOfficial ? <OfficialApp /> : <App />}</StrictMode>,
);
