import preact from "eslint-config-preact";

export default preact.map((config) => ({
  ...config,
  files: ["**/*.{js,jsx,ts,tsx}"],
}));
