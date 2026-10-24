// Job statuses, shared by the pipeline and the dashboard. No imports and no Node APIs: the dashboard compiles it too.
// Lifecycle: the scan writes new, filtered and stale; the LLM stages move new on to the rest.
export const JOB_STATUSES = [
  "new", "filtered", "stale", "needs_review", "apply", "maybe", "skip", "cv_ready", "applied", "interview", "rejected", "dismissed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** You sent an application: these keep its dates. */
export const SENT: readonly JobStatus[] = ["applied", "interview", "rejected"];
