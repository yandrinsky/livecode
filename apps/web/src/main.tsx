import "@fontsource-variable/manrope";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import { ConfigProvider, theme } from "antd";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth";
import "./styles.css";
import "./overrides.css";

createRoot(document.getElementById("root")!).render(<StrictMode><ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorPrimary: "#9bff65", colorInfo: "#9bff65", colorBgBase: "#090b0e", colorBgContainer: "#11151a", colorBorder: "#293039", colorText: "#e8edf2", colorTextSecondary: "#86919e", borderRadius: 5, fontFamily: "'Manrope Variable', sans-serif", controlHeight: 40 }, components: { Button: { primaryColor: "#071006", fontWeight: 700 }, Modal: { contentBg: "#11151a", headerBg: "#11151a" }, Input: { activeShadow: "0 0 0 2px rgba(155,255,101,.12)" } } }}><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></ConfigProvider></StrictMode>);
