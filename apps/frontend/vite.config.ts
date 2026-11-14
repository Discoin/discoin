import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import preact from "@preact/preset-vite";

const LOCAL_API = "http://localhost:8000";

const apiProxy = {
  "/api": {
    target: LOCAL_API,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

function apiMode(): Plugin {
  return {
    name: "discoin-api-mode",
    config: (_, { mode }) => ({
      define: { "import.meta.env.VITE_API_MODE": JSON.stringify(mode) },
    }),
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    apiMode(),
    preact({
      prerender: {
        enabled: true,
        renderTarget: "#app",
        additionalPrerenderRoutes: ["/404", "/currency/OAT"],
        previewMiddlewareEnabled: true,
        previewMiddlewareFallback: "/404",
      },
    }),
  ],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
