import React from "react";
import ReactDOM from "react-dom/client";
import "@awesome.me/webawesome/dist/components/icon/icon.js";
import App from "./App";
import "./styles.css";

document.title = "Pokedo - Demo Web App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
