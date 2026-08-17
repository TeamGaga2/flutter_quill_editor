import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const packageRoot = existsSync(resolve(process.cwd(), "packages/protocol"))
  ? resolve(process.cwd(), "packages/protocol")
  : process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
  name: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
};

describe("published protocol package", () => {
  it("publishes the scoped package and shared fixture subpath", () => {
    expect(packageJson.name).toBe("@teamgaga/richtext-protocol");
    expect(packageJson.files).toContain("fixtures");
    expect(packageJson.exports?.["./fixtures/v1.json"]).toBe("./fixtures/v1.json");

    const require = createRequire(import.meta.url);
    expect(require.resolve("@teamgaga/richtext-protocol/fixtures/v1.json")).toBe(
      resolve(packageRoot, "fixtures/v1.json"),
    );
  });

  it("has Delta as its only production dependency", () => {
    expect(packageJson.dependencies).toEqual({
      "@teamgaga/richtext-delta": "workspace:*",
    });
  });

  it("does not reference UI, editor adapters, or DOM globals", () => {
    const source = readdirSync(resolve(packageRoot, "src"))
      .filter((file) => file.endsWith(".ts"))
      .map((file) => readFileSync(resolve(packageRoot, "src", file), "utf8"))
      .join("\n");

    for (const forbidden of [
      "@teamgaga/richtext-core",
      "richtext-solid",
      "richtext-quill",
      "richtext-host-web",
      "HTMLElement",
      "window.",
      "document.",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
