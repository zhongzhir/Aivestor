import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve("src/app/api/user/api-key/route.ts"),
  "utf8"
);
const componentSource = readFileSync(
  resolve("src/components/project/ApiKeyConfig.tsx"),
  "utf8"
);

assert.match(
  routeSource,
  /export async function DELETE\(\)/,
  "API Key route should expose an authenticated DELETE action"
);
assert.match(
  routeSource,
  /api_key_encrypted = NULL/,
  "removing a personal key should clear the encrypted credential"
);
assert.match(
  routeSource,
  /ai_base_url = NULL/,
  "removing a personal key should clear its custom endpoint"
);
assert.match(
  componentSource,
  /fetch\("\/api\/user\/api-key", \{ method: "DELETE" \}\)/,
  "settings UI should call the API Key removal endpoint"
);
assert.match(
  componentSource,
  /移除自有 Key，使用平台额度/,
  "settings UI should offer a clear switch back to platform quota"
);
assert.match(
  componentSource,
  /切回平台免费额度。确认继续/,
  "removing a personal key should require explicit confirmation"
);

console.log("api-key-removal tests passed");
