import solid from "vite-plugin-solid";

export default ({ mode }: { mode: string }) => ({
  base:
    process.env.BASE_URL ??
    (mode === "github-pages" || process.env.GITHUB_PAGES === "true"
      ? "/flutter_quill_editor/"
      : "/"),
  plugins: [solid()],
});
