import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ReputationEntryDurableStore } from "../../apps/web/src/server/reputation-entry-pilot/durable-store";

describe("ReputationEntryDurableStore resource lifecycle", () => {
  it("releases SQLite resources when initialization fails after open", async () => {
    const fixture = await createFixture("donelayer-durable-failed-init-");
    try {
      new ReputationEntryDurableStore(fixture.databasePath, {
        historicalMarkerPath: fixture.markerPath,
      }).close();
      await writeFile(fixture.markerPath, "tampered marker\n", "utf8");

      let observedError: unknown;
      try {
        new ReputationEntryDurableStore(fixture.databasePath, {
          historicalMarkerPath: fixture.markerPath,
        });
      } catch (error) {
        observedError = error;
      }

      expect(observedError).toBeInstanceOf(Error);
      expect((observedError as Error).message).toBe("HISTORICAL_PILOT_MARKER_INTEGRITY_MISMATCH");
      await removeSqliteFixture(fixture);
      expect(existsSync(fixture.root)).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("supports successful open, use, close, and immediate deletion", async () => {
    const fixture = await createFixture("donelayer-durable-success-");
    try {
      const store = new ReputationEntryDurableStore(fixture.databasePath, {
        historicalMarkerPath: fixture.markerPath,
      });
      store.appendRecord({
        recordType: "PILOT_OUTCOME",
        recordId: "successful-lifecycle",
        payload: { result: "PASS" },
      });
      expect(store.getRecord("PILOT_OUTCOME", "successful-lifecycle")?.payload).toEqual({ result: "PASS" });
      store.close();

      await removeSqliteFixture(fixture);
      expect(existsSync(fixture.root)).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("supports open, close, reopen, and close without leaking handles", async () => {
    const fixture = await createFixture("donelayer-durable-reopen-");
    try {
      const first = new ReputationEntryDurableStore(fixture.databasePath, {
        historicalMarkerPath: fixture.markerPath,
      });
      first.appendRecord({
        recordType: "PILOT_OUTCOME",
        recordId: "repeated-lifecycle",
        payload: { sequence: 1 },
      });
      first.close();

      const second = new ReputationEntryDurableStore(fixture.databasePath, {
        historicalMarkerPath: fixture.markerPath,
      });
      expect(second.getRecord("PILOT_OUTCOME", "repeated-lifecycle")?.payload).toEqual({ sequence: 1 });
      second.close();

      await removeSqliteFixture(fixture);
      expect(existsSync(fixture.root)).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("treats repeated close calls as safe and keeps the store closed", async () => {
    const fixture = await createFixture("donelayer-durable-double-close-");
    try {
      const store = new ReputationEntryDurableStore(fixture.databasePath, {
        historicalMarkerPath: fixture.markerPath,
      });
      store.close();
      expect(() => store.close()).not.toThrow();
      expect(() => store.getRecord("PILOT_OUTCOME", "missing")).toThrow("REPUTATION_ENTRY_DURABLE_STORE_CLOSED");

      await removeSqliteFixture(fixture);
      expect(existsSync(fixture.root)).toBe(false);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function createFixture(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const markerPath = path.join(root, "historical-marker.json");
  const databasePath = path.join(root, "durable-store.sqlite");
  await writeFile(markerPath, "historical marker\n", "utf8");
  return { root, markerPath, databasePath };
}

async function removeSqliteFixture(fixture: { root: string; markerPath: string; databasePath: string }): Promise<void> {
  for (const filePath of [
    `${fixture.databasePath}-wal`,
    `${fixture.databasePath}-shm`,
    fixture.databasePath,
    fixture.markerPath,
  ]) {
    if (existsSync(filePath)) await rm(filePath);
  }
  await rm(fixture.root, { recursive: true });
}
