const KEY = "mt.watchedRun";

export function rememberWatchedRun(runId: string): void {
  try {
    sessionStorage.setItem(KEY, runId);
  } catch {
    // Storage blocked: no PiP this session.
  }
}

export function forgetWatchedRun(runId: string): void {
  try {
    if (sessionStorage.getItem(KEY) === runId) sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}

export function watchedRun(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
