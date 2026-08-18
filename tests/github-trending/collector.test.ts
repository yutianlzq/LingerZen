import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	collectGitHubTrending,
	type GitHubTrendingCollectorClient,
} from "../../src/lib/github-trending/collector";
import { openTrendingDatabase } from "../../src/lib/github-trending/database";
import type { TrackedRepository } from "../../src/lib/github-trending/github-client";

function repository(
	id: number,
	stars: number,
	forks: number,
	createdAt = "2020-01-01T00:00:00.000Z",
): TrackedRepository {
	return {
		repositoryId: id,
		nodeId: `R_${id}`,
		name: `repository-${id}`,
		fullName: `owner/repository-${id}`,
		ownerLogin: "owner",
		ownerAvatarUrl: null,
		description: `Repository ${id}`,
		language: id % 2 === 0 ? "Rust" : "TypeScript",
		topics: ["trending"],
		homepageUrl: "https://example.com/project",
		licenseSpdxId: "MIT",
		createdAt,
		updatedAt: "2026-08-18T00:00:00.000Z",
		pushedAt: "2026-08-18T00:00:00.000Z",
		isArchived: false,
		stars,
		forks,
		openIssues: id,
		trackingSources: [
			{
				source: "top_stars",
				lastDiscoveredAt: "2026-08-18",
				trackUntil: null,
			},
		],
	};
}

function createTemporaryDatabase(t: test.TestContext) {
	const directory = mkdtempSync(join(tmpdir(), "lingerzen-collector-"));
	const database = openTrendingDatabase(join(directory, "trending.sqlite"));
	t.after(() => {
		database.close();
		rmSync(directory, { recursive: true, force: true });
	});
	return database;
}

function createClient(
	discover: (runDate: string) => Promise<TrackedRepository[]>,
): GitHubTrendingCollectorClient {
	return {
		discoverRepositories: discover,
		refreshRepositories: async () => ({
			repositories: [],
			unavailableNodeIds: [],
		}),
	};
}

test("collects snapshots and materializes total rankings atomically", async (t) => {
	const database = createTemporaryDatabase(t);
	const client = createClient(async () => [
		repository(2, 200, 10),
		repository(1, 300, 5),
	]);

	const result = await collectGitHubTrending({
		database,
		client,
		runDate: "2026-08-18",
		now: new Date("2026-08-18T01:00:00.000Z"),
		leaseToken: "lease-1",
	});

	assert.equal(result.outcome, "completed");
	assert.equal(result.candidateCount, 2);
	assert.equal(result.snapshotCount, 2);
	assert.deepEqual(
		database
			.prepare(
				"SELECT category, repository_id, rank FROM rankings WHERE captured_date = ? ORDER BY category, rank",
			)
			.all("2026-08-18")
			.map((row) => ({ ...row })),
		[
			{ category: "top_forks", repository_id: 2, rank: 1 },
			{ category: "top_forks", repository_id: 1, rank: 2 },
			{ category: "top_stars", repository_id: 1, rank: 1 },
			{ category: "top_stars", repository_id: 2, rank: 2 },
		],
	);
	const run = {
		...database
			.prepare(
				"SELECT status, candidate_count, snapshot_count FROM collection_runs WHERE run_date = ?",
			)
			.get("2026-08-18"),
	};
	assert.deepEqual(run, {
		status: "completed",
		candidate_count: 2,
		snapshot_count: 2,
	});
});

test("skips an already completed date before calling GitHub", async (t) => {
	const database = createTemporaryDatabase(t);
	let calls = 0;
	const client = createClient(async () => {
		calls += 1;
		return [repository(1, 100, 10)];
	});
	const input = {
		database,
		client,
		runDate: "2026-08-18",
		now: new Date("2026-08-18T01:00:00.000Z"),
		leaseToken: "lease-1",
	};
	await collectGitHubTrending(input);
	const repeated = await collectGitHubTrending({
		...input,
		leaseToken: "lease-2",
		now: new Date("2026-08-18T02:00:00.000Z"),
	});

	assert.equal(repeated.outcome, "already_completed");
	assert.equal(calls, 1);
	assert.equal(
		Number(
			(
				database
					.prepare("SELECT COUNT(*) AS count FROM repository_snapshots")
					.get() as { count: number }
			).count,
		),
		1,
	);
});

test("uses prior snapshots to materialize daily growth on the next date", async (t) => {
	const database = createTemporaryDatabase(t);
	const dailyData = new Map([
		["2026-08-17", [repository(1, 100, 10), repository(2, 80, 8)]],
		["2026-08-18", [repository(1, 130, 12), repository(2, 80, 8)]],
	]);
	const client = createClient(async (runDate) => dailyData.get(runDate) ?? []);

	await collectGitHubTrending({
		database,
		client,
		runDate: "2026-08-17",
		now: new Date("2026-08-17T01:00:00.000Z"),
		leaseToken: "lease-1",
	});
	await collectGitHubTrending({
		database,
		client,
		runDate: "2026-08-18",
		now: new Date("2026-08-18T01:00:00.000Z"),
		leaseToken: "lease-2",
	});

	const daily = database
		.prepare(
			"SELECT repository_id, metric_delta, baseline_date FROM rankings WHERE captured_date = ? AND category = 'star_daily'",
		)
		.all("2026-08-18")
		.map((row) => ({ ...row }));
	assert.deepEqual(daily, [
		{ repository_id: 1, metric_delta: 30, baseline_date: "2026-08-17" },
	]);
});

test("rolls back partial writes, marks failure, and supports a clean retry", async (t) => {
	const database = createTemporaryDatabase(t);
	let shouldFail = true;
	const client = createClient(async () => {
		if (shouldFail) {
			return [
				repository(1, 100, 10),
				{ ...repository(2, 90, 9), fullName: "owner/repository-1" },
			];
		}
		return [repository(1, 110, 11)];
	});

	await assert.rejects(
		collectGitHubTrending({
			database,
			client,
			runDate: "2026-08-18",
			now: new Date("2026-08-18T01:00:00.000Z"),
			leaseToken: "lease-1",
		}),
		/GitHub Trending collection failed/,
	);
	assert.equal(
		Number(
			(
				database
					.prepare("SELECT COUNT(*) AS count FROM repository_snapshots")
					.get() as { count: number }
			).count,
		),
		0,
	);
	assert.equal(
		String(
			(
				database
					.prepare("SELECT status FROM collection_runs WHERE run_date = ?")
					.get("2026-08-18") as { status: string }
			).status,
		),
		"failed",
	);

	shouldFail = false;
	const retry = await collectGitHubTrending({
		database,
		client,
		runDate: "2026-08-18",
		now: new Date("2026-08-18T02:00:00.000Z"),
		leaseToken: "lease-2",
	});
	assert.equal(retry.outcome, "completed");
	assert.equal(
		Number(
			(
				database
					.prepare("SELECT COUNT(*) AS count FROM repository_snapshots")
					.get() as { count: number }
			).count,
		),
		1,
	);
});
