import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");
const intelligence = readFileSync(resolve(root, "src/lib/intelligence.ts"), "utf8");
const validation = readFileSync(resolve(root, "scripts/research-quality-personalized-validation.ts"), "utf8");
const coreStart = intelligence.indexOf("export async function generateResearchBrief");
const wrapperStart = intelligence.indexOf("export async function generateBrief", coreStart);
const core = intelligence.slice(coreStart, wrapperStart);
const wrapper = intelligence.slice(wrapperStart, intelligence.indexOf("export async function runScheduledTasks", wrapperStart));

assert.ok(coreStart >= 0 && wrapperStart > coreStart, "research generation core must be exported separately from persistence");
assert.doesNotMatch(core, /persistBrief\s*\(/, "shared generation core must not persist intelligence briefs");
assert.match(wrapper, /generateResearchBrief\(userId, input, now, credentials\)/, "generateBrief must use the shared generation core");
assert.match(wrapper, /persistBrief\(userId, taskId, brief, scheduledSlot\)/, "generateBrief must retain the existing persistence step");
assert.match(validation, /generateResearchBrief/, "personalized validation must use the shared generation core");
assert.doesNotMatch(validation, /persistBrief\s*\(|generateBrief\s*\(/, "personalized validation must not invoke a persistence path");

console.log("intelligence research generation/persistence boundary tests passed");
