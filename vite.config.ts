import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api/yfinance": {
        target: "http://localhost:5001",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/yfinance/, ""),
      },
      "/api/yf": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/yf/, ""),
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
