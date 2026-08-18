import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
	acquireCollectionRun,
	completeCollectionRun,
	failCollectionRun,
	openTrendingDatabase,
} from "../../src/lib/github-trending/database";

function createTemporaryDatabase(t: test.TestContext) {
	const directory = mkdtempSync(join(tmpdir(), "lingerzen-trending-"));
	const path = join(directory, "trending.sqlite");
	const database = openTrendingDatabase(path);
	t.after(() => {
		database.close();
		rmSync(directory, { force: true, recursive: true });
	});
	return { database, path };
}

test("opens a file-backed database with required pragmas and schema", (t) => {
	const { database } = createTemporaryDatabase(t);
	const tables = database
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all()
		.map((row) => String(row.name));

	assert.deepEqual(tables, [
		"collection_runs",
		"rankings",
		"repositories",
		"repository_snapshots",
		"schema_migrations",
		"tracking_sources",
	]);
	assert.equal(
		Number(
			(
				database.prepare("PRAGMA foreign_keys").get() as {
					foreign_keys: number;
				}
			).foreign_keys,
		),
		1,
	);
	assert.equal(
		String(
			(
				database.prepare("PRAGMA journal_mode").get() as {
					journal_mode: string;
				}
			).journal_mode,
		),
		"wal",
	);
	assert.ok(
		Number(
			(
				database.prepare("PRAGMA busy_timeout").get() as {
					timeout: number;
				}
			).timeout,
		) >= 2_000,
	);
	assert.equal(
		Number(
			(
				database
					.prepare("SELECT COUNT(*) AS count FROM schema_migrations")
					.get() as { count: number }
			).count,
		),
		1,
	);
});

test("rejects snapshots that reference an unknown repository", (t) => {
	const { database } = createTemporaryDatabase(t);

	assert.throws(
		() =>
			database
				.prepare(
					"INSERT INTO repository_snapshots (repository_id, captured_date, stars, forks, open_issues, updated_at, pushed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				)
				.run(999, "2026-08-18", 1, 1, 0, null, null),
		/FOREIGN KEY constraint failed/,
	);
});

test("acquires one active collection run per date and supports expired lease takeover", (t) => {
	const { database } = createTemporaryDatabase(t);
	const startedAt = new Date("2026-08-18T00:00:00.000Z");
	const first = acquireCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "first-token",
		now: startedAt,
		leaseDurationMs: 60_000,
	});

	assert.equal(first.outcome, "acquired");
	assert.throws(
		() =>
			acquireCollectionRun(database, {
				runDate: "2026-08-18",
				leaseToken: "second-token",
				now: new Date("2026-08-18T00:00:30.000Z"),
				leaseDurationMs: 60_000,
			}),
		/collection is already running/,
	);

	const takeover = acquireCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "takeover-token",
		now: new Date("2026-08-18T00:02:00.000Z"),
		leaseDurationMs: 60_000,
	});
	assert.equal(takeover.outcome, "acquired");
	assert.equal(takeover.leaseToken, "takeover-token");

	completeCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "takeover-token",
		finishedAt: new Date("2026-08-18T00:03:00.000Z"),
		candidateCount: 12,
		snapshotCount: 10,
	});

	const completed = acquireCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "after-complete",
		now: new Date("2026-08-18T00:04:00.000Z"),
		leaseDurationMs: 60_000,
	});
	assert.equal(completed.outcome, "already_completed");
});

test("only the current lease owner can fail a running collection", (t) => {
	const { database } = createTemporaryDatabase(t);
	acquireCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "owner-token",
		now: new Date("2026-08-18T00:00:00.000Z"),
		leaseDurationMs: 60_000,
	});

	assert.throws(
		() =>
			failCollectionRun(database, {
				runDate: "2026-08-18",
				leaseToken: "other-token",
				finishedAt: new Date("2026-08-18T00:01:00.000Z"),
				errorSummary: "safe failure",
			}),
		/collection lease is no longer active/,
	);

	failCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "owner-token",
		finishedAt: new Date("2026-08-18T00:01:00.000Z"),
		errorSummary: "safe failure",
	});

	assert.throws(
		() =>
			completeCollectionRun(database, {
				runDate: "2026-08-18",
				leaseToken: "owner-token",
				finishedAt: new Date("2026-08-18T00:02:00.000Z"),
				candidateCount: 1,
				snapshotCount: 1,
			}),
		/collection lease is no longer active/,
	);
});

test("reports recovery when retrying a failed collection without erasing its error", (t) => {
	const { database } = createTemporaryDatabase(t);
	acquireCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "first-token",
		now: new Date("2026-08-18T00:00:00.000Z"),
		leaseDurationMs: 60_000,
	});
	failCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "first-token",
		finishedAt: new Date("2026-08-18T00:01:00.000Z"),
		errorSummary: "upstream unavailable",
	});

	const retry = acquireCollectionRun(database, {
		runDate: "2026-08-18",
		leaseToken: "retry-token",
		now: new Date("2026-08-18T00:02:00.000Z"),
		leaseDurationMs: 60_000,
	});
	assert.equal(retry.outcome, "recovered");
	const row = database
		.prepare(
			"SELECT status, error_summary FROM collection_runs WHERE run_date = ?",
		)
		.get("2026-08-18") as { status: string; error_summary: string | null };
	assert.equal(row.status, "running");
	assert.equal(row.error_summary, "upstream unavailable");
});

test("rejects unsafe database paths and unknown legacy schemas", (t) => {
	assert.throws(
		() => openTrendingDatabase("relative/trending.sqlite"),
		/database path must be absolute/,
	);
	assert.throws(
		() => openTrendingDatabase(`${tmpdir()}\ntrending.sqlite`),
		/database path contains control characters/,
	);

	const directory = mkdtempSync(join(tmpdir(), "lingerzen-trending-legacy-"));
	const path = join(directory, "trending.sqlite");
	const legacy = new DatabaseSync(path);
	legacy.exec("CREATE TABLE unexpected (id INTEGER PRIMARY KEY)");
	legacy.close();
	t.after(() => rmSync(directory, { force: true, recursive: true }));
	assert.throws(
		() => openTrendingDatabase(path),
		/database contains an unknown schema/,
	);
});
