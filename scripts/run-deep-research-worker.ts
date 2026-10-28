import { processNextDeepResearchJob } from "../src/lib/deepResearchJobs";

const loop = process.argv.includes("--loop");
const idleMsArg = process.argv.find((arg) => arg.startsWith("--idle-ms="));
const idleMs = Math.max(1_000, Math.min(60_000, Number(idleMsArg?.split("=")[1] ?? 5_000)));

async function run() {
  do {
    try {
      const jobId = await processNextDeepResearchJob();
      if (jobId) console.log(`[deep-research-worker] completed ${jobId}`);
      else if (!loop) console.log("[deep-research-worker] queue empty");
      if (!jobId && loop) await new Promise((resolve) => setTimeout(resolve, idleMs));
    } catch (error) {
      console.error("[deep-research-worker] job failed", error);
      if (loop) await new Promise((resolve) => setTimeout(resolve, idleMs));
    }
  } while (loop);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
