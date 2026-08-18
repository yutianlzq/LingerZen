import {
	GITHUB_TRENDING_CATEGORIES,
	type GitHubTrendingCategory,
	type RankingQuery,
} from "./types";

const CATEGORY_SET = new Set<string>(GITHUB_TRENDING_CATEGORIES);
const PER_PAGE_OPTIONS = new Set([10, 20, 50, 100]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SEARCH_LENGTH = 64;
const MAX_PAGE = 1_000;

export type RankingQueryContext = {
	availableDates: string[];
	availableLanguages: string[];
	defaultDate: string;
};

export type RankingSql = {
	sql: string;
	bindings: Array<string | number>;
};

type RankingFilters = {
	whereSql: string;
	bindings: Array<string | number>;
};

function isValidDate(value: string): boolean {
	if (!ISO_DATE_PATTERN.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return (
		!Number.isNaN(parsed.valueOf()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

function parsePositiveInteger(value: string | null, fallback: number): number {
	if (!value || !/^\d+$/.test(value)) return fallback;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseRankingQuery(
	params: URLSearchParams,
	context: RankingQueryContext,
): RankingQuery {
	const rawCategory = params.get("category") ?? "";
	const category = CATEGORY_SET.has(rawCategory)
		? (rawCategory as GitHubTrendingCategory)
		: "top_stars";
	const rawDate = params.get("date") ?? "";
	const date =
		isValidDate(rawDate) && context.availableDates.includes(rawDate)
			? rawDate
			: context.defaultDate;
	const rawLanguage = params.get("language") ?? "";
	const language = context.availableLanguages.includes(rawLanguage)
		? rawLanguage
		: null;
	const page = Math.min(parsePositiveInteger(params.get("page"), 1), MAX_PAGE);
	const rawPerPage = parsePositiveInteger(params.get("per_page"), 20);
	const perPage = PER_PAGE_OPTIONS.has(rawPerPage) ? rawPerPage : 20;
	const search = (params.get("search") ?? "")
		.trim()
		.slice(0, MAX_SEARCH_LENGTH);

	return { category, date, language, page, perPage, search };
}

function escapeLikePattern(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function buildRankingFilters(query: RankingQuery): RankingFilters {
	const filters = ["rankings.captured_date = ?", "rankings.category = ?"];
	const bindings: Array<string | number> = [query.date, query.category];
	if (query.language) {
		filters.push("repositories.language = ?");
		bindings.push(query.language);
	}
	if (query.search) {
		filters.push(
			"(repositories.full_name LIKE ? ESCAPE '\\' OR repositories.description LIKE ? ESCAPE '\\' OR repositories.topics_json LIKE ? ESCAPE '\\')",
		);
		const pattern = `%${escapeLikePattern(query.search)}%`;
		bindings.push(pattern, pattern, pattern);
	}
	return { whereSql: filters.join(" AND "), bindings };
}

export function buildRankingCountQuery(query: RankingQuery): RankingSql {
	const filters = buildRankingFilters(query);
	return {
		sql: `
SELECT COUNT(*) AS total_count
FROM rankings
JOIN repositories ON repositories.repository_id = rankings.repository_id
WHERE ${filters.whereSql}`.trim(),
		bindings: filters.bindings,
	};
}

export function buildRankingQuery(query: RankingQuery): RankingSql {
	const filters = buildRankingFilters(query);
	return {
		sql: `
SELECT
	rankings.category,
	rankings.captured_date,
	rankings.rank,
	rankings.metric_value,
	rankings.metric_delta,
	rankings.baseline_date,
	repositories.*,
	repository_snapshots.stars,
	repository_snapshots.forks,
	repository_snapshots.open_issues
FROM rankings
JOIN repositories ON repositories.repository_id = rankings.repository_id
JOIN repository_snapshots
	ON repository_snapshots.repository_id = rankings.repository_id
	AND repository_snapshots.captured_date = rankings.captured_date
WHERE ${filters.whereSql}
ORDER BY rankings.rank ASC
LIMIT ? OFFSET ?`.trim(),
		bindings: [
			...filters.bindings,
			query.perPage,
			(query.page - 1) * query.perPage,
		],
	};
}
