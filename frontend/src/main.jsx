import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./styles.css";

const container = document.getElementById("app");
if (!container) {
  throw new Error("Root container missing in index.html");
}

createRoot(container).render(<App />);