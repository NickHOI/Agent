import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../tsconfig.build.json", import.meta.url), "utf8"));

assert.equal(config.compilerOptions?.module, "NodeNext", "module must remain NodeNext");
assert.equal(config.compilerOptions?.moduleResolution, "NodeNext", "moduleResolution must match the NodeNext module target");
assert.equal(config.compilerOptions?.rootDir, "src", "rootDir must remain src");
assert.equal(config.compilerOptions?.outDir, "dist", "outDir must remain dist");
assert.deepEqual(config.include, ["src/**/*.ts"], "the build include boundary must contain only source files");
