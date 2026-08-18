import assert from "node:assert/strict";
import test from "node:test";
import {
	computeRankings,
	type RankingCandidate,
} from "../../src/lib/github-trending/ranking";

function candidate(
	id: number,
	stars: number,
	forks: number,
	createdAt = "2020-01-01T00:00:00.000Z",
): RankingCandidate {
	return {
		repositoryId: id,
		fullName: `owner/repository-${id}`,
		stars,
		forks,
		createdAt,
	};
}

test("builds deterministic total star and fork rankings", () => {
	const rankings = computeRankings({
		capturedDate: "2026-08-18",
		candidates: [
			candidate(2, 100, 80),
			candidate(1, 100, 20),
			candidate(3, 50, 90),
		],
		baselines: new Map(),
		limit: 100,
	});

	assert.deepEqual(
		rankings.top_stars.map((entry) => entry.repositoryId),
		[1, 2, 3],
	);
	assert.deepEqual(
		rankings.top_forks.map((entry) => entry.repositoryId),
		[3, 2, 1],
	);
});

test("uses the nearest available baseline on or before the target date", () => {
	const rankings = computeRankings({
		capturedDate: "2026-08-18",
		candidates: [candidate(1, 130, 10)],
		baselines: new Map([
			[
				1,
				[
					{ capturedDate: "2026-08-10", stars: 100, forks: 8 },
					{ capturedDate: "2026-08-12", stars: 110, forks: 9 },
					{ capturedDate: "2026-08-17", stars: 125, forks: 10 },
				],
			],
		]),
		limit: 100,
	});

	assert.equal(rankings.star_daily[0]?.metricDelta, 5);
	assert.equal(rankings.star_daily[0]?.baselineDate, "2026-08-17");
	assert.equal(rankings.star_weekly[0]?.metricDelta, 30);
	assert.equal(rankings.star_weekly[0]?.baselineDate, "2026-08-10");
});

test("excludes old repositories without a baseline and counts new repositories from zero", () => {
	const rankings = computeRankings({
		capturedDate: "2026-08-18",
		candidates: [
			candidate(1, 200, 20, "2020-01-01T00:00:00.000Z"),
			candidate(2, 80, 4, "2026-08-15T00:00:00.000Z"),
		],
		baselines: new Map(),
		limit: 100,
	});

	assert.deepEqual(
		rankings.star_weekly.map((entry) => entry.repositoryId),
		[2],
	);
	assert.equal(rankings.star_weekly[0]?.metricDelta, 80);
	assert.equal(rankings.star_weekly[0]?.baselineDate, null);
	assert.equal(rankings.star_daily.length, 0);
});

test("caps result size even when the requested limit is not finite", () => {
	const candidates = Array.from({ length: 150 }, (_, index) =>
		candidate(index + 1, 1_000 - index, 500 - index),
	);
	const rankings = computeRankings({
		capturedDate: "2026-08-18",
		candidates,
		baselines: new Map(),
		limit: Number.POSITIVE_INFINITY,
	});

	assert.equal(rankings.top_stars.length, 100);
	assert.equal(rankings.top_forks.length, 100);
});

test("keeps only positive growth and applies stable tie breaking", () => {
	const rankings = computeRankings({
		capturedDate: "2026-08-18",
		candidates: [
			candidate(2, 120, 8),
			candidate(1, 120, 8),
			candidate(3, 90, 8),
		],
		baselines: new Map([
			[1, [{ capturedDate: "2026-08-17", stars: 100, forks: 7 }]],
			[2, [{ capturedDate: "2026-08-17", stars: 100, forks: 7 }]],
			[3, [{ capturedDate: "2026-08-17", stars: 100, forks: 7 }]],
		]),
		limit: 100,
	});

	assert.deepEqual(
		rankings.star_daily.map((entry) => entry.repositoryId),
		[1, 2],
	);
	assert.ok(rankings.star_daily.every((entry) => entry.metricDelta > 0));
});
