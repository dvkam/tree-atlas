import { once } from "node:events";
import { createServer, request } from "node:http";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { blockExternalTiles, ready, reference, url } from "./helpers.ts";

// A real second origin is needed because the browser installs workers outside page routing.
async function updateOrigin(upstream: string) {
  const worker = await fetch(new URL("/sw.js", upstream));
  if (!worker.ok) throw new Error("Build and start the production pilot before this test.");
  const program = await worker.text();
  let candidate = program + "\n// Worker-only update\n";
  let phase: "original" | "unavailable" | "recovered" = "original";
  let failedDownloads = 0;
  const server = createServer((incoming, outgoing) => {
    const path = incoming.url ?? "/";
    if (path === "/sw.js") {
      outgoing.setHeader("Cache-Control", "no-store");
      outgoing.setHeader("Content-Type", "text/javascript");
      // Exercise the collision case even if a future build reuses a shell name.
      outgoing.end(phase === "original" ? program : candidate);
      return;
    }
    if (phase === "unavailable" && path === "/data/local-config.json") {
      failedDownloads++;
      outgoing.writeHead(503, { "Cache-Control": "no-store" }).end();
      return;
    }
    const target = new URL(upstream);
    const relay = request(
      {
        hostname: target.hostname,
        port: target.port,
        method: incoming.method,
        path,
        headers: incoming.headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    relay.on("error", () => outgoing.destroy());
    outgoing.on("close", () => relay.destroy());
    incoming.pipe(relay);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Missing test port");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    failUpdate: () => {
      phase = "unavailable";
    },
    recover: () => {
      phase = "recovered";
    },
    failures: () => failedDownloads,
    stageNewCache: (current: string) => {
      if (!program.includes(current))
        throw new Error("The production worker did not own the active cache");
      const next = current + "-next";
      candidate = program.replace(current, next);
      return next;
    },
    close: async () => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}

function shellCaches(page: Page) {
  return page.evaluate(async () =>
    (await caches.keys()).filter((name) => name.startsWith("tree-atlas-local-shell-")).sort(),
  );
}

async function installUpdate(page: Page): Promise<ServiceWorkerState> {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const finished = new Promise<ServiceWorkerState>((resolve, reject) => {
      registration.addEventListener(
        "updatefound",
        () => {
          const candidate = registration.installing;
          if (!candidate) {
            reject(new Error("Missing candidate worker"));
            return;
          }
          const changed = () => {
            if (candidate.state === "redundant" || candidate.state === "installed")
              resolve(candidate.state);
          };
          candidate.addEventListener("statechange", changed);
          changed();
        },
        { once: true },
      );
    });
    await registration.update();
    return finished;
  });
}

test("the last working shell reopens a downloaded city after a failed worker-only update", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Missing local pilot URL");
  const server = await updateOrigin(baseURL);
  try {
    await blockExternalTiles(context);
    const sample = reference("porto", "leading-zeros");
    await page.goto(server.origin + url("porto", { q: sample.q }));
    await ready(page, "porto", sample.total);
    await page.getByRole("button", { name: "Download city for offline use", exact: true }).click();
    await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible({ timeout: 90_000 });
    await page.getByRole("button", { name: "Use downloaded city", exact: true }).click();
    await ready(page, "porto", sample.total);
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const [oldCache] = await shellCaches(page);
    if (!oldCache) throw new Error("No active production app shell");
    server.failUpdate();
    expect(await installUpdate(page)).toBe("redundant");
    expect(server.failures()).toBeGreaterThan(0);
    expect(await shellCaches(page)).toEqual([oldCache]);
    await context.setOffline(true);
    await page.reload();
    await ready(page, "porto", sample.total);
    await expect(page.getByRole("heading", { name: "Downloaded city" })).toBeVisible();
    await expect(page.getByText(/^Offline pack ready/u).first()).toBeVisible();

    // A repaired update may install while the old tab is open. It activates after the tab closes.
    await context.setOffline(false);
    const nextCache = server.stageNewCache(oldCache);
    expect(await installUpdate(page)).toBe("redundant");
    expect(await shellCaches(page)).toEqual([oldCache]);
    server.recover();
    expect(await installUpdate(page)).toBe("installed");
    const previous = await page.evaluate(() => navigator.serviceWorker.controller?.state);
    expect(previous).toBe("activated");
    const waiting = await page.evaluate(
      async () => (await navigator.serviceWorker.ready).waiting?.state,
    );
    expect(waiting).toBe("installed");
    expect(await shellCaches(page)).toEqual([oldCache, nextCache]);
    await context.setOffline(true);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(server.origin + url("porto", { q: sample.q }));
    await ready(reopened, "porto", sample.total);
    await expect(reopened.getByRole("heading", { name: "Downloaded city" })).toBeVisible();
    await expect.poll(() => shellCaches(reopened)).toEqual([nextCache]);
  } finally {
    await context.setOffline(false);
    await server.close();
  }
});
