import React from "react";
import ReactDOM from "react-dom/client";

import "@/assets/globals.css";

import { Showcase } from "./Showcase";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Showcase />
  </React.StrictMode>,
);
