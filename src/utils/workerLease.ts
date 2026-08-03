export class WorkerLeaseLostError extends Error {
  constructor() {
    super("Worker lease could not be renewed");
    this.name = "WorkerLeaseLostError";
  }
}

export const runWithLeaseHeartbeat = async <T>(
  operation: () => Promise<T>,
  extendLease: () => Promise<boolean>,
  leaseMs: number,
): Promise<T> => {
  let extending = false;
  let leaseLost = false;
  let pendingHeartbeat: Promise<void> | undefined;
  const heartbeatEveryMs = Math.max(1_000, Math.floor(leaseMs / 3));
  const heartbeat = setInterval(() => {
    if (extending || leaseLost) return;
    extending = true;
    pendingHeartbeat = extendLease()
      .then((extended) => {
        if (!extended) leaseLost = true;
      })
      .catch(() => {
        leaseLost = true;
      })
      .finally(() => {
        extending = false;
      });
  }, heartbeatEveryMs);
  heartbeat.unref();

  try {
    const value = await operation();
    await pendingHeartbeat;
    if (leaseLost) throw new WorkerLeaseLostError();
    return value;
  } finally {
    clearInterval(heartbeat);
  }
};

export const isWorkerLeaseLostError = (
  error: unknown,
): error is WorkerLeaseLostError => error instanceof WorkerLeaseLostError;
