import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openTrendingDatabase } from "../../src/lib/github-trending/database";
import {
	getRepositoryDetail,
	getTrendingPage,
} from "../../src/lib/github-trending/query-service";

function createTemporaryDatabase(t: test.TestContext) {
	const directory = mkdtempSync(join(tmpdir(), "lingerzen-query-"));
	const database = openTrendingDatabase(join(directory, "trending.sqlite"));
	t.after(() => {
		database.close();
		rmSync(directory, { recursive: true, force: true });
	});
	return database;
}

function seedRepository(
	database: ReturnType<typeof openTrendingDatabase>,
	input: {
		id: number;
		fullName: string;
		language: string | null;
		description: string;
		topics: string[];
	},
) {
	const [owner, name] = input.fullName.split("/");
	database
		.prepare(
			`INSERT INTO repositories (
	repository_id, node_id, full_name, owner_login, name, owner_avatar_url,
	description, language, topics_json, homepage_url, license_spdx_id,
	created_at, updated_at, pushed_at, is_archived, is_unavailable,
	first_seen_at, last_seen_at
) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'MIT', ?, ?, ?, 0, 0, ?, ?)`,
		)
		.run(
			input.id,
			`R_${input.id}`,
			input.fullName,
			owner,
			name,
			input.description,
			input.language,
			JSON.stringify(input.topics),
			"https://example.com/project",
			"2020-01-01T00:00:00.000Z",
			"2026-08-18T00:00:00.000Z",
			"2026-08-18T00:00:00.000Z",
			"2026-08-17",
			"2026-08-18",
		);
}

function seedSnapshotAndRanking(
	database: ReturnType<typeof openTrendingDatabase>,
	input: {
		date: string;
		repositoryId: number;
		rank: number;
		stars: number;
		forks: number;
		delta?: number;
	},
) {
	database
		.prepare(
			`INSERT INTO repository_snapshots (
	repository_id, captured_date, stars, forks, open_issues, updated_at, pushed_at
) VALUES (?, ?, ?, ?, 3, ?, ?)`,
		)
		.run(
			input.repositoryId,
			input.date,
			input.stars,
			input.forks,
			`${input.date}T00:00:00.000Z`,
			`${input.date}T00:00:00.000Z`,
		);
	database
		.prepare(
			`INSERT INTO rankings (
	captured_date, category, rank, repository_id, metric_value, metric_delta, baseline_date
) VALUES (?, 'top_stars', ?, ?, ?, ?, ?)`,
		)
		.run(
			input.date,
			input.rank,
			input.repositoryId,
			input.stars,
			input.delta ?? 0,
			input.delta ? "2026-08-17" : null,
		);
}

test("returns an empty state before the first successful collection", (t) => {
	const database = createTemporaryDatabase(t);
	const page = getTrendingPage(database, new URLSearchParams());

	assert.equal(page.status, "empty");
	assert.equal(page.items.length, 0);
	assert.equal(page.latestSuccessfulDate, null);
	assert.equal(page.total, 0);
});

test("returns filtered paginated rankings and stale collection metadata", (t) => {
	const database = createTemporaryDatabase(t);
	seedRepository(database, {
		id: 1,
		fullName: "owner/astro-tool",
		language: "TypeScript",
		description: "Astro developer tool",
		topics: ["astro", "tooling"],
	});
	seedRepository(database, {
		id: 2,
		fullName: "owner/rust-tool",
		language: "Rust",
		description: "Rust developer tool",
		topics: ["rust"],
	});
	seedSnapshotAndRanking(database, {
		date: "2026-08-18",
		repositoryId: 1,
		rank: 1,
		stars: 200,
		forks: 20,
	});
	seedSnapshotAndRanking(database, {
		date: "2026-08-18",
		repositoryId: 2,
		rank: 2,
		stars: 150,
		forks: 30,
	});
	database
		.prepare(
			"INSERT INTO collection_runs (run_date, status, started_at, finished_at) VALUES (?, 'completed', ?, ?)",
		)
		.run("2026-08-18", "2026-08-18T01:00:00.000Z", "2026-08-18T01:01:00.000Z");
	database
		.prepare(
			"INSERT INTO collection_runs (run_date, status, started_at, finished_at, error_summary) VALUES (?, 'failed', ?, ?, ?)",
		)
		.run(
			"2026-08-19",
			"2026-08-19T01:00:00.000Z",
			"2026-08-19T01:01:00.000Z",
			"GitHub request failed with status 503",
		);

	const page = getTrendingPage(
		database,
		new URLSearchParams({
			category: "top_stars",
			date: "2026-08-18",
			language: "TypeScript",
			search: "100% astro_tool",
			per_page: "10",
		}),
	);

	assert.equal(page.status, "ready");
	assert.equal(page.isStale, true);
	assert.equal(page.latestSuccessfulDate, "2026-08-18");
	assert.deepEqual(page.availableDates, ["2026-08-18"]);
	assert.deepEqual(page.availableLanguages, ["Rust", "TypeScript"]);
	assert.equal(page.total, 0);
	assert.equal(page.totalPages, 1);

	const visible = getTrendingPage(
		database,
		new URLSearchParams({
			date: "2026-08-18",
			language: "TypeScript",
			search: "astro",
			per_page: "10",
		}),
	);
	assert.equal(visible.total, 1);
	assert.equal(visible.items[0]?.fullName, "owner/astro-tool");
	assert.deepEqual(visible.items[0]?.topics, ["astro", "tooling"]);

	const clamped = getTrendingPage(
		database,
		new URLSearchParams({
			date: "2026-08-18",
			page: "999",
			per_page: "10",
		}),
	);
	assert.equal(clamped.total, 2);
	assert.equal(clamped.totalPages, 1);
	assert.equal(clamped.query.page, 1);
	assert.equal(clamped.items.length, 2);
});

test("returns a repository detail with bounded history and rejects unsafe slugs", (t) => {
	const database = createTemporaryDatabase(t);
	seedRepository(database, {
		id: 1,
		fullName: "Owner/Astro-Tool",
		language: "TypeScript",
		description: "Astro developer tool",
		topics: ["astro"],
	});
	database
		.prepare(
			"UPDATE repositories SET owner_avatar_url = ?, homepage_url = ? WHERE repository_id = 1",
		)
		.run("javascript:alert(1)", "data:text/html,unsafe");
	for (const [date, stars, forks] of [
		["2026-07-01", 100, 10],
		["2026-08-17", 190, 19],
		["2026-08-18", 200, 20],
	] as const) {
		database
			.prepare(
				`INSERT INTO repository_snapshots (
	repository_id, captured_date, stars, forks, open_issues, updated_at, pushed_at
) VALUES (1, ?, ?, ?, 3, ?, ?)`,
			)
			.run(
				date,
				stars,
				forks,
				`${date}T00:00:00.000Z`,
				`${date}T00:00:00.000Z`,
			);
	}

	const detail = getRepositoryDetail(database, "owner", "astro-tool", 999);
	assert.equal(detail?.repository.fullName, "Owner/Astro-Tool");
	assert.equal(detail?.repository.ownerAvatarUrl, null);
	assert.equal(detail?.repository.homepageUrl, null);
	assert.deepEqual(
		detail?.history.map((point) => point.date),
		["2026-07-01", "2026-08-17", "2026-08-18"],
	);
	assert.equal(
		getRepositoryDetail(database, "../owner", "astro-tool", 30),
		null,
	);
	assert.equal(getRepositoryDetail(database, "owner", "astro/tool", 30), null);
});
