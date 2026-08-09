import assert from "node:assert/strict";
import { getSystemAIBaseURL, getSystemAIProvider, getSystemApiKey, isSystemKeyAvailable } from "@/lib/freeQuota";

const names = ["SYSTEM_AI_PROVIDER", "SYSTEM_AI_API_KEY", "SYSTEM_DEEPSEEK_API_KEY", "BAILIAN_API_KEY"] as const;
const original = Object.fromEntries(names.map((name) => [name, process.env[name]]));

function env(values: Partial<Record<(typeof names)[number], string | undefined>>, check: () => void) {
  for (const name of names) {
    if (name in values) {
      if (values[name] === undefined) delete process.env[name];
      else process.env[name] = values[name];
    } else delete process.env[name];
  }
  check();
}

env({ SYSTEM_DEEPSEEK_API_KEY: "xxx", BAILIAN_API_KEY: "yyy" }, () => {
  assert.equal(getSystemApiKey(), "xxx");
  assert.equal(getSystemAIProvider(), "deepseek");
  assert.equal(isSystemKeyAvailable(), true);
});

env({ BAILIAN_API_KEY: "yyy" }, () => {
  assert.equal(getSystemApiKey(), null);
  assert.equal(getSystemAIProvider(), "deepseek");
  assert.equal(isSystemKeyAvailable(), false);
});

env({ SYSTEM_AI_PROVIDER: "qwen", SYSTEM_AI_API_KEY: "xxx", BAILIAN_API_KEY: "yyy" }, () => {
  assert.equal(getSystemApiKey(), "xxx");
  assert.equal(getSystemAIProvider(), "qwen");
  assert.equal(getSystemAIBaseURL(), "https://dashscope.aliyuncs.com/compatible-mode/v1");
});

env({ SYSTEM_DEEPSEEK_API_KEY: "xxx", BAILIAN_API_KEY: "yyy" }, () => {
  assert.doesNotMatch(getSystemApiKey() ?? "", /yyy/);
  assert.equal(getSystemAIProvider(), "deepseek");
});

for (const name of names) {
  const value = original[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
console.log("free quota provider matrix tests passed");
