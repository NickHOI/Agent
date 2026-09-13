import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const config = JSON.parse(await readFile(new URL("tsconfig.build.json", root), "utf8"));

assert.equal(config.compilerOptions?.target, "ES2022", "target must remain ES2022");
assert.equal(config.compilerOptions?.module, "ESNext", "module must remain ESNext");
assert.equal(config.compilerOptions?.moduleResolution, "Bundler", "moduleResolution must remain Bundler");
assert.equal(config.compilerOptions?.baseUrl, ".", "baseUrl must remain the package root");
assert.deepEqual(config.compilerOptions?.paths, {
  "@shared/*": ["src/shared/*"],
}, "@shared must resolve to the source shared directory");
assert.equal(config.compilerOptions?.rootDir, "src", "rootDir must remain src");
assert.equal(config.compilerOptions?.noEmit, true, "the verification build must remain noEmit");
assert.equal(config.compilerOptions?.strict, true, "strict mode must remain enabled");
assert.deepEqual(config.include, ["src/**/*.ts"], "the build include boundary must contain only source files");

const aliasTarget = config.compilerOptions.paths["@shared/*"][0].replace("*", "version.ts");
await access(new URL(aliasTarget, root));
