import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "happy-dom",
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["clients/**", "**/dist/**"],
  },
  lint: {
    ignorePatterns: ["clients/**", "**/dist/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
