import { readFile, readdir } from "node:fs/promises";

export type BrowserMemorySample = {
  startedElapsedMs: number;
  elapsedMs: number;
  captureDurationMs: number;
  phase: string;
  processes: number;
  rssKiB: number;
  pssKiB: number | null;
  missingPssProcesses: number;
  roles: Record<string, number>;
};

/** The owned Linux browser process tree includes renderer/worker native memory.
 * RSS sums double-count shared pages; PSS is reported only when every process is readable.
 * Sampling can miss transient peaks and does not isolate individual worker heaps.
 */
export async function browserMemory(rootPid: number, intervalMs = 250) {
  if (process.platform !== "linux")
    throw new Error("Browser process memory sampling requires Linux /proc.");
  const started = performance.now();
  const samples: BrowserMemorySample[] = [];
  const errors: string[] = [];
  let phase = "launch";
  const stop = new AbortController();

  async function capture() {
    const samplePhase = phase;
    const captureStarted = performance.now();
    const processes = new Map<number, number>();
    for (const name of await readdir("/proc")) {
      if (!/^\d+$/u.test(name)) continue;
      try {
        const value = await readFile(`/proc/${name}/stat`, "utf8");
        const fields = value.slice(value.lastIndexOf(")") + 2).split(" ");
        const parent = Number(fields[1]);
        if (Number.isSafeInteger(parent)) processes.set(Number(name), parent);
      } catch {
        /* A process can exit between directory and stat reads. */
      }
    }
    const owned = new Set([rootPid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [pid, parent] of processes) {
        if (owned.has(parent) && !owned.has(pid)) {
          owned.add(pid);
          changed = true;
        }
      }
    }
    let rssKiB = 0;
    let pssKiB = 0;
    let missingPssProcesses = 0;
    let observed = 0;
    const roles: Record<string, number> = {};
    for (const pid of owned) {
      try {
        const status = await readFile(`/proc/${pid}/status`, "utf8");
        const rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/mu)?.[1];
        if (rss === undefined) continue;
        const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
        rssKiB += Number(rss);
        observed++;
        const role =
          pid === rootPid ? "browser" : (command.match(/--type=([^\0 ]+)/u)?.[1] ?? "other");
        roles[role] = (roles[role] ?? 0) + 1;
        try {
          const rollup = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
          const pss = rollup.match(/^Pss:\s+(\d+)\s+kB$/mu)?.[1];
          if (pss === undefined) missingPssProcesses++;
          else pssKiB += Number(pss);
        } catch {
          missingPssProcesses++;
        }
      } catch {
        /* A renderer can exit while the browser remains alive. */
      }
    }
    if (observed === 0) throw new Error("The owned browser process tree could not be sampled.");
    samples.push({
      startedElapsedMs: captureStarted - started,
      elapsedMs: performance.now() - started,
      captureDurationMs: performance.now() - captureStarted,
      phase: samplePhase,
      processes: observed,
      rssKiB,
      pssKiB: missingPssProcesses === 0 ? pssKiB : null,
      missingPssProcesses,
      roles,
    });
  }
  await capture();
  const loop = (async () => {
    while (!stop.signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      if (stop.signal.aborted) break;
      try {
        await capture();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
  })();
  return {
    phase(name: string) {
      phase = name;
    },
    async finish() {
      stop.abort();
      await loop;
      await capture();
      const peakPss = (values: BrowserMemorySample[]) =>
        Math.max(
          0,
          ...values.flatMap((sample) => (sample.pssKiB === null ? [] : [sample.pssKiB])),
        ) || null;
      return {
        intervalMs,
        maximumObservedSampleGapMs: Math.max(
          0,
          ...samples
            .slice(1)
            .map(
              (sample, index) => sample.startedElapsedMs - (samples[index]?.startedElapsedMs ?? 0),
            ),
        ),
        samples,
        errors,
        sampledPeakRssKiB: Math.max(...samples.map((sample) => sample.rssKiB)),
        sampledPeakPssKiB: samples.every((sample) => sample.pssKiB !== null)
          ? peakPss(samples)
          : null,
        availableSamplePssPeakKiB: peakPss(samples),
        completePssSamples: samples.filter((sample) => sample.pssKiB !== null).length,
        byPhase: [...new Set(samples.map((sample) => sample.phase))].map((name) => {
          const values = samples.filter((sample) => sample.phase === name);
          return {
            phase: name,
            samples: values.length,
            sampledPeakRssKiB: Math.max(...values.map((sample) => sample.rssKiB)),
            sampledPeakPssKiB: values.every((sample) => sample.pssKiB !== null)
              ? peakPss(values)
              : null,
            completePssSamples: values.filter((sample) => sample.pssKiB !== null).length,
          };
        }),
      };
    },
  };
}
