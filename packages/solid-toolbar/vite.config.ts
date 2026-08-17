// vite.config.ts
import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";
import solidRolldown from "unplugin-solid/rolldown";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },

  plugins: [solid()],

  pack: {
    plugins: [solidRolldown()],

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
