import type { DatabaseSync } from "node:sqlite";
import {
	buildRankingCountQuery,
	buildRankingQuery,
	parseRankingQuery,
} from "./query-params";
import {
	GITHUB_TRENDING_HISTORY_WINDOWS,
	type GitHubTrendingCategory,
	type RankingQuery,
} from "./types";

export type TrendingRepositoryItem = {
	repositoryId: number;
	fullName: string;
	ownerLogin: string;
	name: string;
	ownerAvatarUrl: string | null;
	description: string | null;
	language: string | null;
	topics: string[];
	homepageUrl: string | null;
	licenseSpdxId: string | null;
	createdAt: string;
	updatedAt: string | null;
	pushedAt: string | null;
	isArchived: boolean;
	rank: number;
	stars: number;
	forks: number;
	openIssues: number;
	metricValue: number;
	metricDelta: number;
	baselineDate: string | null;
};

export type TrendingPageData = {
	status: "empty" | "ready";
	isStale: boolean;
	latestSuccessfulDate: string | null;
	lastAttemptDate: string | null;
	lastAttemptStatus: "running" | "completed" | "failed" | null;
	availableDates: string[];
	availableLanguages: string[];
	query: RankingQuery;
	items: TrendingRepositoryItem[];
	total: number;
	totalPages: number;
};

export type TrendPoint = {
	date: string;
	stars: number;
	forks: number;
};

export type RepositoryDetailData = {
	repository: Omit<
		TrendingRepositoryItem,
		"rank" | "metricValue" | "metricDelta" | "baselineDate"
	> & {
		firstSeenAt: string;
		lastSeenAt: string;
	};
	history: TrendPoint[];
};

type RankingRow = {
	total_count: number;
	repository_id: number;
	full_name: string;
	owner_login: string;
	name: string;
	owner_avatar_url: string | null;
	description: string | null;
	language: string | null;
	topics_json: string;
	homepage_url: string | null;
	license_spdx_id: string | null;
	created_at: string;
	updated_at: string | null;
	pushed_at: string | null;
	is_archived: number;
	rank: number;
	stars: number | null;
	forks: number | null;
	open_issues: number | null;
	metric_value: number;
	metric_delta: number;
	baseline_date: string | null;
};

type RunRow = {
	run_date: string;
	status: "running" | "completed" | "failed";
};

const REPOSITORY_SEGMENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;
const HISTORY_WINDOWS = new Set<number>(GITHUB_TRENDING_HISTORY_WINDOWS);

function normalizePublicHttpUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

function parseTopics(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed
					.filter((topic): topic is string => typeof topic === "string")
					.slice(0, 20)
			: [];
	} catch {
		return [];
	}
}

function mapRankingRow(row: RankingRow): TrendingRepositoryItem {
	return {
		repositoryId: Number(row.repository_id),
		fullName: row.full_name,
		ownerLogin: row.owner_login,
		name: row.name,
		ownerAvatarUrl: normalizePublicHttpUrl(row.owner_avatar_url),
		description: row.description,
		language: row.language,
		topics: parseTopics(row.topics_json),
		homepageUrl: normalizePublicHttpUrl(row.homepage_url),
		licenseSpdxId: row.license_spdx_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		pushedAt: row.pushed_at,
		isArchived: row.is_archived === 1,
		rank: Number(row.rank),
		stars: Number(row.stars),
		forks: Number(row.forks),
		openIssues: Number(row.open_issues),
		metricValue: Number(row.metric_value),
		metricDelta: Number(row.metric_delta),
		baselineDate: row.baseline_date,
	};
}

function getAvailableDates(database: DatabaseSync): string[] {
	return database
		.prepare(
			"SELECT DISTINCT captured_date FROM rankings ORDER BY captured_date DESC",
		)
		.all()
		.map((row) => String(row.captured_date));
}

function getAvailableLanguages(database: DatabaseSync): string[] {
	return database
		.prepare(
			"SELECT DISTINCT language FROM repositories WHERE language IS NOT NULL AND language <> '' ORDER BY language COLLATE NOCASE",
		)
		.all()
		.map((row) => String(row.language));
}

function getRunState(database: DatabaseSync): {
	latestSuccessfulDate: string | null;
	lastAttemptDate: string | null;
	lastAttemptStatus: RunRow["status"] | null;
	isStale: boolean;
} {
	const latestSuccessfulDate =
		(
			database
				.prepare(
					"SELECT run_date FROM collection_runs WHERE status = 'completed' ORDER BY run_date DESC LIMIT 1",
				)
				.get() as { run_date: string } | undefined
		)?.run_date ?? null;
	const lastAttempt = database
		.prepare(
			"SELECT run_date, status FROM collection_runs ORDER BY run_date DESC LIMIT 1",
		)
		.get() as RunRow | undefined;
	return {
		latestSuccessfulDate,
		lastAttemptDate: lastAttempt?.run_date ?? null,
		lastAttemptStatus: lastAttempt?.status ?? null,
		isStale:
			latestSuccessfulDate !== null &&
			lastAttempt !== undefined &&
			lastAttempt.run_date > latestSuccessfulDate &&
			lastAttempt.status !== "completed",
	};
}

export function getTrendingPage(
	database: DatabaseSync,
	searchParams: URLSearchParams,
): TrendingPageData {
	const availableDates = getAvailableDates(database);
	const availableLanguages = getAvailableLanguages(database);
	const runState = getRunState(database);
	const defaultDate = availableDates[0] ?? "";
	const query = parseRankingQuery(searchParams, {
		availableDates,
		availableLanguages,
		defaultDate,
	});
	if (!defaultDate) {
		return {
			status: "empty",
			isStale: false,
			latestSuccessfulDate: runState.latestSuccessfulDate,
			lastAttemptDate: runState.lastAttemptDate,
			lastAttemptStatus: runState.lastAttemptStatus,
			availableDates,
			availableLanguages,
			query,
			items: [],
			total: 0,
			totalPages: 1,
		};
	}

	const countQuery = buildRankingCountQuery(query);
	const total = Number(
		(
			database.prepare(countQuery.sql).get(...countQuery.bindings) as {
				total_count: number;
			}
		).total_count,
	);
	const totalPages = Math.max(1, Math.ceil(total / query.perPage));
	const normalizedQuery = {
		...query,
		page: Math.min(query.page, totalPages),
	};
	const built = buildRankingQuery(normalizedQuery);
	const rows = database
		.prepare(built.sql)
		.all(...built.bindings) as RankingRow[];
	return {
		status: "ready",
		isStale: runState.isStale,
		latestSuccessfulDate: runState.latestSuccessfulDate,
		lastAttemptDate: runState.lastAttemptDate,
		lastAttemptStatus: runState.lastAttemptStatus,
		availableDates,
		availableLanguages,
		query: normalizedQuery,
		items: rows.map(mapRankingRow),
		total,
		totalPages,
	};
}

function subtractDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() - days);
	return parsed.toISOString().slice(0, 10);
}

function isSafeRepositorySegment(value: string): boolean {
	return REPOSITORY_SEGMENT_PATTERN.test(value);
}

export function getRepositoryDetail(
	database: DatabaseSync,
	owner: string,
	repositoryName: string,
	windowDays: number,
): RepositoryDetailData | null {
	if (
		!isSafeRepositorySegment(owner) ||
		!isSafeRepositorySegment(repositoryName)
	) {
		return null;
	}
	const repository = database
		.prepare(
			`SELECT repositories.*, snapshots.stars, snapshots.forks, snapshots.open_issues
FROM repositories
LEFT JOIN repository_snapshots AS snapshots
	ON snapshots.repository_id = repositories.repository_id
	AND snapshots.captured_date = (
		SELECT MAX(captured_date)
		FROM repository_snapshots
		WHERE repository_id = repositories.repository_id
	)
WHERE lower(repositories.full_name) = lower(?)
LIMIT 1`,
		)
		.get(`${owner}/${repositoryName}`) as
		| (RankingRow & { first_seen_at: string; last_seen_at: string })
		| undefined;
	if (!repository || repository.stars === null) return null;
	const normalizedWindow = HISTORY_WINDOWS.has(windowDays) ? windowDays : 90;
	const latestDate = String(
		(
			database
				.prepare(
					"SELECT MAX(captured_date) AS captured_date FROM repository_snapshots WHERE repository_id = ?",
				)
				.get(repository.repository_id) as { captured_date: string }
		).captured_date,
	);
	const startDate = subtractDays(latestDate, normalizedWindow - 1);
	const history = database
		.prepare(
			`SELECT captured_date, stars, forks
FROM repository_snapshots
WHERE repository_id = ? AND captured_date >= ?
ORDER BY captured_date ASC`,
		)
		.all(repository.repository_id, startDate)
		.map((row) => ({
			date: String(row.captured_date),
			stars: Number(row.stars),
			forks: Number(row.forks),
		}));
	const mapped = mapRankingRow({
		...repository,
		total_count: 1,
		rank: 0,
		metric_value: Number(repository.stars),
		metric_delta: 0,
		baseline_date: null,
	});
	const {
		rank: _rank,
		metricValue: _metricValue,
		metricDelta: _metricDelta,
		baselineDate: _baselineDate,
		...repositoryData
	} = mapped;
	return {
		repository: {
			...repositoryData,
			firstSeenAt: repository.first_seen_at,
			lastSeenAt: repository.last_seen_at,
		},
		history,
	};
}

export const CATEGORY_LABELS: Record<GitHubTrendingCategory, string> = {
	top_stars: "Star 总榜",
	top_forks: "Fork 总榜",
	star_daily: "日增 Star",
	star_weekly: "周增 Star",
	star_monthly: "月增 Star",
};
