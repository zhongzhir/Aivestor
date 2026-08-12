import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "research-quality-ai-first-validation.ts"), "utf8");
assert.match(source, /overallStatus: "failed"/, "a failed case must produce an explicit failed overall status");
assert.match(source, /process\.exitCode = 1/, "a failed case must return a non-zero process exit code");
assert.match(source, /return;\s*\n\s*}\s*\n\s*}\s*\n\s*const output = \{[\s\S]*overallStatus: "passed"/, "case failure must stop the default fail-fast loop before success output");
assert.match(source, /overallStatus: "passed"/, "all successful cases must produce an explicit passed overall status");
assert.match(source, /durationMs: Date\.now\(\) - allStartedAt/, "top-level duration must cover every case");
assert.match(source, /qualityFailureCodes/, "every case must emit structured quality gates");
assert.match(source, /FACT_WITHOUT_BODY_EVIDENCE/, "body-evidence failures must fail acceptance");
assert.match(source, /UNSUPPORTED_COMPARATIVE_ASSERTION/, "unsupported comparisons must fail acceptance");
assert.match(source, /CASE_DURATION_EXCEEDED/, "slow cases must fail acceptance before the internal deadline");
console.log("research quality validation exit tests passed");
