import { hostname } from "node:os";
import {
  enqueueDueIntelligenceRuns,
  heartbeatIntelligenceWorker,
  initializeScheduledTasks,
  processNextIntelligenceRun,
  recordIntelligenceSchedulerCycle,
} from "../src/lib/intelligenceRuns";

const loop = process.argv.includes("--loop");
const idleArg = process.argv.find((argument) => argument.startsWith("--idle-ms="));
const idleMs = Math.max(1_000, Math.min(60_000, Number(idleArg?.split("=")[1] ?? 5_000)));
const schedulerIntervalMs = process.env.NODE_ENV === "test"
  ? Math.max(25, Math.min(30_000, Number(process.env.INTELLIGENCE_TEST_SCHEDULER_INTERVAL_MS) || 30_000))
  : 30_000;
const workerKey = `${hostname()}:${process.pid}`;
const startedAt = new Date();

let scheduling = false;
async function schedulingCycle() {
  if (scheduling) return;
  scheduling = true;
  await heartbeatIntelligenceWorker(workerKey, startedAt);
  try {
    await initializeScheduledTasks();
    await enqueueDueIntelligenceRuns();
    await recordIntelligenceSchedulerCycle(workerKey, true);
  } catch (error) {
    await recordIntelligenceSchedulerCycle(workerKey, false, error instanceof Error ? error.name : "cycle_failed").catch(() => {});
    throw error;
  } finally {
    scheduling = false;
  }
}

async function cycle() {
  await schedulingCycle();
  return processNextIntelligenceRun(workerKey);
}

async function run() {
  const heartbeatTimer = loop ? setInterval(() => {
    heartbeatIntelligenceWorker(workerKey, startedAt).catch((error) => {
      console.error("[intelligence-worker] heartbeat failed", error instanceof Error ? error.message : error);
    });
  }, schedulerIntervalMs) : null;
  const schedulerTimer = loop ? setInterval(() => {
    schedulingCycle().catch((error) => {
      console.error("[intelligence-worker] scheduling cycle failed", error instanceof Error ? error.message : error);
    });
  }, schedulerIntervalMs) : null;
  try {
    do {
      try {
        const runId = await cycle();
        if (runId) console.log(`[intelligence-worker] processed ${runId}`);
        else if (!loop) console.log("[intelligence-worker] queue empty");
        if (!runId && loop) await new Promise((resolve) => setTimeout(resolve, idleMs));
      } catch (error) {
        console.error("[intelligence-worker] cycle failed", error instanceof Error ? error.message : error);
        if (loop) await new Promise((resolve) => setTimeout(resolve, idleMs));
        else throw error;
      }
    } while (loop);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (schedulerTimer) clearInterval(schedulerTimer);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
