import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyAndReleaseConsumers } from "./package-consumer-lifecycle.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("verifies and releases consumers in input order", async () => {
  const consumers = [{ label: "first" }, { label: "second" }] as const;
  const events: string[] = [];

  await verifyAndReleaseConsumers(
    consumers,
    async (consumer) => {
      events.push(`verify:${consumer.label}`);
    },
    async (consumer) => {
      events.push(`release:${consumer.label}`);
    },
  );

  expect(events).toEqual([
    "verify:first",
    "release:first",
    "verify:second",
    "release:second",
  ]);
});

test("awaits verification and release before starting the next consumer", async () => {
  const verification = deferred();
  const releaseStarted = deferred();
  const release = deferred();
  const events: string[] = [];

  const completion = verifyAndReleaseConsumers(
    ["first", "second"],
    async (consumer) => {
      events.push(`verify:start:${consumer}`);
      if (consumer === "first") await verification.promise;
      events.push(`verify:done:${consumer}`);
    },
    async (consumer) => {
      events.push(`release:start:${consumer}`);
      if (consumer === "first") {
        releaseStarted.resolve();
        await release.promise;
      }
      events.push(`release:done:${consumer}`);
    },
  );

  try {
    expect(events).toEqual(["verify:start:first"]);
    verification.resolve();
    await releaseStarted.promise;
    expect(events).toEqual([
      "verify:start:first",
      "verify:done:first",
      "release:start:first",
    ]);
    release.resolve();
    await completion;
    expect(events).toEqual([
      "verify:start:first",
      "verify:done:first",
      "release:start:first",
      "release:done:first",
      "verify:start:second",
      "verify:done:second",
      "release:start:second",
      "release:done:second",
    ]);
  } finally {
    verification.resolve();
    release.resolve();
    await completion;
  }
});

test("preserves verification errors without releasing the failed consumer or continuing", async () => {
  const failure = new Error("verification failed");
  const events: string[] = [];

  await expect(verifyAndReleaseConsumers(
    ["first", "second", "third"],
    async (consumer) => {
      events.push(`verify:${consumer}`);
      if (consumer === "second") throw failure;
    },
    async (consumer) => {
      events.push(`release:${consumer}`);
    },
  )).rejects.toBe(failure);

  expect(events).toEqual(["verify:first", "release:first", "verify:second"]);
});

test("preserves release errors and stops before the next consumer", async () => {
  const failure = new Error("release failed");
  const events: string[] = [];

  await expect(verifyAndReleaseConsumers(
    ["first", "second"],
    async (consumer) => {
      events.push(`verify:${consumer}`);
    },
    async (consumer) => {
      events.push(`release:${consumer}`);
      throw failure;
    },
  )).rejects.toBe(failure);

  expect(events).toEqual(["verify:first", "release:first"]);
});

test("does not invoke callbacks for an empty consumer list", async () => {
  const events: string[] = [];

  await expect(verifyAndReleaseConsumers<string>(
    [],
    async (consumer) => {
      events.push(`verify:${consumer}`);
    },
    async (consumer) => {
      events.push(`release:${consumer}`);
    },
  )).resolves.toBeUndefined();

  expect(events).toEqual([]);
});

test("releases each consumer directory while preserving the shared archive and temporary directory", async () => {
  const work = await mkdtemp(join(tmpdir(), "hraness-ui-consumer-lifecycle-"));
  const archive = join(work, "package.tgz");
  const temporary = join(work, "tmp");
  const temporaryFile = join(temporary, "shared.txt");

  try {
    await mkdir(temporary);
    await writeFile(archive, "archive fixture");
    await writeFile(temporaryFile, "shared temporary fixture");

    await verifyAndReleaseConsumers(
      ["react-18", "react-19"],
      async (consumer) => {
        expect((await readdir(work)).sort()).toEqual(["package.tgz", "tmp"]);
        expect(await readFile(archive, "utf8")).toBe("archive fixture");
        expect(await readFile(temporaryFile, "utf8")).toBe("shared temporary fixture");
        const dependencies = join(work, consumer, "node_modules");
        await mkdir(dependencies, { recursive: true });
        await writeFile(join(dependencies, "fixture.txt"), consumer);
      },
      async (consumer) => {
        await rm(join(work, consumer), { recursive: true, force: true });
      },
    );

    expect((await readdir(work)).sort()).toEqual(["package.tgz", "tmp"]);
    expect(await readFile(archive, "utf8")).toBe("archive fixture");
    expect(await readFile(temporaryFile, "utf8")).toBe("shared temporary fixture");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
