import assert from "node:assert/strict";
import test from "node:test";
import {
	buildRankingQuery,
	parseRankingQuery,
} from "../../src/lib/github-trending/query-params";

test("parses supported query values and clamps numeric inputs", () => {
	const params = new URLSearchParams({
		category: "star_weekly",
		date: "2026-08-18",
		language: "TypeScript",
		page: "999999",
		per_page: "100",
		search: "  astro  ",
	});
	const parsed = parseRankingQuery(params, {
		availableDates: ["2026-08-18", "2026-08-17"],
		availableLanguages: ["TypeScript", "Rust"],
		defaultDate: "2026-08-18",
	});

	assert.deepEqual(parsed, {
		category: "star_weekly",
		date: "2026-08-18",
		language: "TypeScript",
		page: 1_000,
		perPage: 100,
		search: "astro",
	});
});

test("falls back to safe defaults for invalid filters", () => {
	const params = new URLSearchParams({
		category: "top_stars; DROP TABLE rankings",
		date: "2026-02-30",
		language: "Unknown",
		page: "-5",
		per_page: "999",
		search: "x".repeat(500),
	});
	const parsed = parseRankingQuery(params, {
		availableDates: ["2026-08-18"],
		availableLanguages: ["TypeScript"],
		defaultDate: "2026-08-18",
	});

	assert.equal(parsed.category, "top_stars");
	assert.equal(parsed.date, "2026-08-18");
	assert.equal(parsed.language, null);
	assert.equal(parsed.page, 1);
	assert.equal(parsed.perPage, 20);
	assert.equal(parsed.search.length, 64);
});

test("builds a parameterized ranking query and escapes LIKE wildcards", () => {
	const built = buildRankingQuery({
		category: "star_daily",
		date: "2026-08-18",
		language: "TypeScript",
		page: 2,
		perPage: 20,
		search: "100%_safe\\value",
	});

	assert.doesNotMatch(built.sql, /100%_safe/);
	assert.doesNotMatch(built.sql, /TypeScript/);
	assert.doesNotMatch(built.sql, /2026-08-18/);
	assert.match(built.sql, /ESCAPE '\\'/);
	assert.deepEqual(built.bindings, [
		"2026-08-18",
		"star_daily",
		"TypeScript",
		"%100\\%\\_safe\\\\value%",
		"%100\\%\\_safe\\\\value%",
		"%100\\%\\_safe\\\\value%",
		20,
		20,
	]);
});
