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

const API_IMPLEMENTATION_ID = "virtual:api-implementation";
const RESOLVED_API_IMPLEMENTATION_ID = "\0" + API_IMPLEMENTATION_ID;

const API_FACTORIES: Record<string, { file: string; factory: string }> = {
  http: { file: "src/api/http.ts", factory: "createHttpApi" },
  mock: { file: "src/mocks/api.ts", factory: "createMockApi" },
};

function apiImplementation(): Plugin {
  let mode: string;
  let root: string;

  return {
    name: "discoin-api-implementation",
    enforce: "pre",
    configResolved(config) {
      mode = config.mode;
      root = config.root;
    },
    resolveId(id) {
      if (id === API_IMPLEMENTATION_ID) return RESOLVED_API_IMPLEMENTATION_ID;
    },
    load(id) {
      if (id !== RESOLVED_API_IMPLEMENTATION_ID) return;

      const chosen = API_FACTORIES[mode];
      if (chosen === undefined) {
        throw new Error(
          `Build with --mode http or --mode mock to pick the API. Got "${mode}".`,
        );
      }

      const file = JSON.stringify(`${root}/${chosen.file}`);

      return `export { ${chosen.factory} as createApi } from ${file};`;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    apiImplementation(),
    preact({
      prerender: {
        enabled: true,
        renderTarget: "#app",
        additionalPrerenderRoutes: ["/404", "/currency/OAT", "/docs"],
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
