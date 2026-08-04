import { runScheduledTasks } from "@/lib/intelligence";

runScheduledTasks()
  .then((count) => {
    console.log(`intelligence scheduler completed: ${count} task(s)`);
    process.exit(0);
  })
  .catch((error) => {
    console.error("intelligence scheduler failed", error);
    process.exit(1);
  });
