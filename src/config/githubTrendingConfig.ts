export const GITHUB_SEARCH_API_URL =
	"https://api.github.com/search/repositories";
export const GITHUB_GRAPHQL_API_URL = "https://api.github.com/graphql";
export const GITHUB_API_VERSION = "2022-11-28";
export const GITHUB_TRENDING_USER_AGENT = "LingerZen-GitHub-Trending";
export const GITHUB_TRENDING_SEARCH_PAGE_SIZE = 100;
export const GITHUB_TRENDING_DISCOVERY_PAGES = 2;
export const GITHUB_TRENDING_GRAPHQL_BATCH_SIZE = 50;
export const GITHUB_TRENDING_TRACKING_DAYS: number = 90;
export const GITHUB_TRENDING_LEASE_DURATION_MS: number = 20 * 60 * 1000;
export const GITHUB_TRENDING_RANKING_LIMIT = 100;
export const GITHUB_TRENDING_RETENTION_DAYS = 400;
export const GITHUB_TRENDING_REQUEST_TIMEOUT_MS: number = 20 * 1000;
export const GITHUB_TRENDING_MAX_ATTEMPTS = 3;

export const GITHUB_TRENDING_SOURCES = [
	"top_stars",
	"top_forks",
	"recent_created",
	"recent_active",
] as const;

export type GitHubTrendingSource = (typeof GITHUB_TRENDING_SOURCES)[number];
