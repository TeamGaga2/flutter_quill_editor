import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  pack: {
    plugins: [solid()],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  test: {
    environment: "happy-dom",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
