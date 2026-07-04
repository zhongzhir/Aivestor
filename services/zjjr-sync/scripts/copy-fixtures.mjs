import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const serviceRoot = resolve(here, "..");
const source = resolve(serviceRoot, "fixtures");
const target = resolve(serviceRoot, "dist", "fixtures");

if (!existsSync(source)) {
  throw new Error(`Missing fixtures directory: ${source}`);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`copied fixtures to ${target}`);
