/// <reference types="vite/client" />

declare module "virtual:api-implementation" {
  export function createApi(): import("./api/client.js").DiscoinApi;
}
