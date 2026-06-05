// Next runs register() once per server process (next dev / next start), in the Node runtime.
// We start the background job worker here so it lives for the life of the process, not a request.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip the edge runtime
  const { startJobWorker } = await import('./lib/jobs/worker');
  startJobWorker();
}
