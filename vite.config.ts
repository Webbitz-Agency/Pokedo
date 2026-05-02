import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devApiProxyTarget = env.VITE_DEV_API_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: devApiProxyTarget,
          changeOrigin: true,
          secure: devApiProxyTarget.startsWith("https://")
        }
      }
    },
    preview: {
      port: 4173,
      proxy: {
        "/api": {
          target: devApiProxyTarget,
          changeOrigin: true,
          secure: devApiProxyTarget.startsWith("https://")
        }
      }
    }
  };
});
