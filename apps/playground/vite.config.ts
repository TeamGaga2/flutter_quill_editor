import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";

export default defineConfig(({ mode }) => ({
  base:
    process.env.BASE_URL ??
    (mode === "github-pages" || process.env.GITHUB_PAGES === "true"
      ? "/flutter_quill_editor/"
      : "/"),
  plugins: [solid()],
}));
