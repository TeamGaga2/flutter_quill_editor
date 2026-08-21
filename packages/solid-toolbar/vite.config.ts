// vite.config.ts
import solid from "vite-plugin-solid";
import solidRolldown from "unplugin-solid/rolldown";

const config: Record<string, unknown> = {
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
};

export default config;
