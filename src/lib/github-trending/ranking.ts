import type { GitHubTrendingCategory, RankingEntry } from "./types";

export type RankingCandidate = {
	repositoryId: number;
	fullName: string;
	stars: number;
	forks: number;
	createdAt: string;
};

export type RankingBaseline = {
	capturedDate: string;
	stars: number;
	forks: number;
};

type RankingInput = {
	capturedDate: string;
	candidates: RankingCandidate[];
	baselines: Map<number, RankingBaseline[]>;
	limit: number;
};

type RankingsByCategory = Record<GitHubTrendingCategory, RankingEntry[]>;

const MAX_RANKING_ENTRIES = 100;

function compareCandidates(
	metric: (candidate: RankingCandidate) => number,
): (left: RankingCandidate, right: RankingCandidate) => number {
	return (left, right) =>
		metric(right) - metric(left) ||
		left.fullName.localeCompare(right.fullName, "en");
}

function createTotalRanking(
	category: "top_stars" | "top_forks",
	candidates: RankingCandidate[],
	metric: (candidate: RankingCandidate) => number,
	limit: number,
): RankingEntry[] {
	return [...candidates]
		.sort(compareCandidates(metric))
		.slice(0, limit)
		.map((candidate, index) => ({
			category,
			repositoryId: candidate.repositoryId,
			rank: index + 1,
			metricValue: metric(candidate),
			metricDelta: 0,
			baselineDate: null,
		}));
}

function subtractDays(date: string, days: number): string {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() - days);
	return value.toISOString().slice(0, 10);
}

function findBaseline(
	baselines: RankingBaseline[] | undefined,
	targetDate: string,
): RankingBaseline | null {
	if (!baselines) return null;
	return (
		[...baselines]
			.filter((baseline) => baseline.capturedDate <= targetDate)
			.sort((left, right) =>
				right.capturedDate.localeCompare(left.capturedDate),
			)[0] ?? null
	);
}

function wasCreatedAfter(candidate: RankingCandidate, date: string): boolean {
	const createdAt = Date.parse(candidate.createdAt);
	const baselineEnd = Date.parse(`${date}T23:59:59.999Z`);
	return Number.isFinite(createdAt) && createdAt > baselineEnd;
}

function createGrowthRanking(
	category: "star_daily" | "star_weekly" | "star_monthly",
	windowDays: number,
	capturedDate: string,
	candidates: RankingCandidate[],
	baselines: Map<number, RankingBaseline[]>,
	limit: number,
): RankingEntry[] {
	const targetDate = subtractDays(capturedDate, windowDays);
	return candidates
		.flatMap<RankingEntry>((candidate) => {
			const baseline = findBaseline(
				baselines.get(candidate.repositoryId),
				targetDate,
			);
			if (!baseline && !wasCreatedAfter(candidate, targetDate)) return [];
			const baselineStars = baseline?.stars ?? 0;
			const metricDelta = candidate.stars - baselineStars;
			if (metricDelta <= 0) return [];
			return [
				{
					category,
					repositoryId: candidate.repositoryId,
					rank: 0,
					metricValue: candidate.stars,
					metricDelta,
					baselineDate: baseline?.capturedDate ?? null,
				},
			];
		})
		.sort(
			(left, right) =>
				right.metricDelta - left.metricDelta ||
				left.repositoryId - right.repositoryId,
		)
		.slice(0, limit)
		.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function computeRankings(input: RankingInput): RankingsByCategory {
	const requestedLimit = Number.isFinite(input.limit)
		? Math.trunc(input.limit)
		: MAX_RANKING_ENTRIES;
	const limit = Math.min(MAX_RANKING_ENTRIES, Math.max(1, requestedLimit));
	return {
		top_stars: createTotalRanking(
			"top_stars",
			input.candidates,
			(candidate) => candidate.stars,
			limit,
		),
		top_forks: createTotalRanking(
			"top_forks",
			input.candidates,
			(candidate) => candidate.forks,
			limit,
		),
		star_daily: createGrowthRanking(
			"star_daily",
			1,
			input.capturedDate,
			input.candidates,
			input.baselines,
			limit,
		),
		star_weekly: createGrowthRanking(
			"star_weekly",
			7,
			input.capturedDate,
			input.candidates,
			input.baselines,
			limit,
		),
		star_monthly: createGrowthRanking(
			"star_monthly",
			30,
			input.capturedDate,
			input.candidates,
			input.baselines,
			limit,
		),
	};
}
