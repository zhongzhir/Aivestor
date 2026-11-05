import { enqueueDueIntelligenceRuns, heartbeatIntelligenceWorker, initializeScheduledTasks } from "@/lib/intelligenceRuns";

const startedAt = new Date();

Promise.all([
  heartbeatIntelligenceWorker("legacy-scheduler-once", startedAt),
  initializeScheduledTasks(startedAt),
]).then(() => enqueueDueIntelligenceRuns(startedAt))
  .then((count) => {
    console.log(`intelligence scheduler queued: ${count} run(s)`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("intelligence scheduler failed", error);
    process.exit(1);
  });
