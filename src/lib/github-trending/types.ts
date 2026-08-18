export const GITHUB_TRENDING_HISTORY_WINDOWS = [30, 90, 365] as const;

export type GitHubTrendingHistoryWindow =
	(typeof GITHUB_TRENDING_HISTORY_WINDOWS)[number];

export const GITHUB_TRENDING_CATEGORIES = [
	"top_stars",
	"top_forks",
	"star_daily",
	"star_weekly",
	"star_monthly",
] as const;

export type GitHubTrendingCategory =
	(typeof GITHUB_TRENDING_CATEGORIES)[number];

export type RankingQuery = {
	category: GitHubTrendingCategory;
	date: string;
	language: string | null;
	page: number;
	perPage: number;
	search: string;
};

export type RankingEntry = {
	category: GitHubTrendingCategory;
	repositoryId: number;
	rank: number;
	metricValue: number;
	metricDelta: number;
	baselineDate: string | null;
};

export type CollectionRunStatus = "running" | "completed" | "failed";
