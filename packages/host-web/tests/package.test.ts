import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

const packageRoot = existsSync(resolve(process.cwd(), "packages/host-web"))
  ? resolve(process.cwd(), "packages/host-web")
  : process.cwd();

const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
  name: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("host-web package boundary", () => {
  it("depends on solid/core/protocol and not quill or toolbar", () => {
    expect(packageJson.name).toBe("@teamgaga/richtext-host-web");
    expect(packageJson.dependencies).toEqual({
      "@teamgaga/richtext-core": "workspace:*",
      "@teamgaga/richtext-protocol": "workspace:*",
      "@teamgaga/richtext-solid": "workspace:*",
    });
    expect(packageJson.peerDependencies).toMatchObject({
      "solid-js": expect.any(String),
    });
    expect(packageJson.dependencies).not.toHaveProperty("@teamgaga/richtext-quill");
    expect(packageJson.dependencies).not.toHaveProperty("@teamgaga/richtext-solid-toolbar");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty("@teamgaga/richtext-quill");
    expect(packageJson.devDependencies ?? {}).not.toHaveProperty(
      "@teamgaga/richtext-solid-toolbar",
    );
  });

  it("does not import quill or solid-toolbar from source", () => {
    const source = collectSourceFiles(resolve(packageRoot, "src"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const forbidden of [
      "@teamgaga/richtext-quill",
      "richtext-solid-toolbar",
      'from "quill"',
      "from 'quill'",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
