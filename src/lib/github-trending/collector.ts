import type { DatabaseSync } from "node:sqlite";
import {
	GITHUB_TRENDING_LEASE_DURATION_MS,
	GITHUB_TRENDING_RANKING_LIMIT,
	GITHUB_TRENDING_RETENTION_DAYS,
} from "@/config/githubTrendingConfig";
import {
	acquireCollectionRun,
	completeCollectionRun,
	failCollectionRun,
} from "./database";
import type {
	RefreshRepositoriesResult,
	TrackedRepository,
} from "./github-client";
import {
	computeRankings,
	type RankingBaseline,
	type RankingCandidate,
} from "./ranking";

export type GitHubTrendingCollectorClient = {
	discoverRepositories: (runDate: string) => Promise<TrackedRepository[]>;
	refreshRepositories: (
		nodeIds: string[],
	) => Promise<RefreshRepositoriesResult>;
};

type CollectGitHubTrendingInput = {
	database: DatabaseSync;
	client: GitHubTrendingCollectorClient;
	runDate: string;
	now: Date;
	leaseToken: string;
};

export type CollectionResult = {
	outcome: "completed" | "already_completed";
	candidateCount: number;
	snapshotCount: number;
};

type StoredRepository = {
	repository_id: number;
	node_id: string;
};

function subtractDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() - days);
	return parsed.toISOString().slice(0, 10);
}

function loadTrackedRepositories(
	database: DatabaseSync,
	runDate: string,
): StoredRepository[] {
	return database
		.prepare(
			`SELECT DISTINCT repositories.repository_id, repositories.node_id
FROM repositories
JOIN tracking_sources ON tracking_sources.repository_id = repositories.repository_id
WHERE repositories.is_unavailable = 0
	AND (tracking_sources.track_until IS NULL OR tracking_sources.track_until >= ?)
ORDER BY repositories.repository_id`,
		)
		.all(runDate) as StoredRepository[];
}

function mergeRepositories(
	discovered: TrackedRepository[],
	refreshed: TrackedRepository[],
): TrackedRepository[] {
	const repositories = new Map<number, TrackedRepository>();
	for (const repository of discovered) {
		repositories.set(repository.repositoryId, repository);
	}
	for (const repository of refreshed) {
		const existing = repositories.get(repository.repositoryId);
		repositories.set(repository.repositoryId, {
			...repository,
			trackingSources: existing?.trackingSources ?? repository.trackingSources,
		});
	}
	return Array.from(repositories.values()).sort(
		(left, right) => left.repositoryId - right.repositoryId,
	);
}

function upsertRepository(
	database: DatabaseSync,
	repository: TrackedRepository,
	runDate: string,
): void {
	database
		.prepare(
			`INSERT INTO repositories (
	repository_id, node_id, full_name, owner_login, name, owner_avatar_url,
	description, language, topics_json, homepage_url, license_spdx_id,
	created_at, updated_at, pushed_at, is_archived, is_unavailable,
	first_seen_at, last_seen_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
ON CONFLICT(repository_id) DO UPDATE SET
	node_id = excluded.node_id,
	full_name = excluded.full_name,
	owner_login = excluded.owner_login,
	name = excluded.name,
	owner_avatar_url = excluded.owner_avatar_url,
	description = excluded.description,
	language = excluded.language,
	topics_json = excluded.topics_json,
	homepage_url = excluded.homepage_url,
	license_spdx_id = excluded.license_spdx_id,
	created_at = excluded.created_at,
	updated_at = excluded.updated_at,
	pushed_at = excluded.pushed_at,
	is_archived = excluded.is_archived,
	is_unavailable = 0,
	last_seen_at = excluded.last_seen_at`,
		)
		.run(
			repository.repositoryId,
			repository.nodeId,
			repository.fullName,
			repository.ownerLogin,
			repository.name,
			repository.ownerAvatarUrl,
			repository.description,
			repository.language,
			JSON.stringify(repository.topics),
			repository.homepageUrl,
			repository.licenseSpdxId,
			repository.createdAt,
			repository.updatedAt,
			repository.pushedAt,
			repository.isArchived ? 1 : 0,
			runDate,
			runDate,
		);
}

function upsertTrackingSources(
	database: DatabaseSync,
	repository: TrackedRepository,
): void {
	const statement = database.prepare(
		`INSERT INTO tracking_sources (
	repository_id, source, last_discovered_at, track_until
) VALUES (?, ?, ?, ?)
ON CONFLICT(repository_id, source) DO UPDATE SET
	last_discovered_at = excluded.last_discovered_at,
	track_until = excluded.track_until`,
	);
	for (const source of repository.trackingSources) {
		statement.run(
			repository.repositoryId,
			source.source,
			source.lastDiscoveredAt,
			source.trackUntil,
		);
	}
}

function insertSnapshot(
	database: DatabaseSync,
	repository: TrackedRepository,
	runDate: string,
): void {
	database
		.prepare(
			`INSERT INTO repository_snapshots (
	repository_id, captured_date, stars, forks, open_issues, updated_at, pushed_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(repository_id, captured_date) DO UPDATE SET
	stars = excluded.stars,
	forks = excluded.forks,
	open_issues = excluded.open_issues,
	updated_at = excluded.updated_at,
	pushed_at = excluded.pushed_at`,
		)
		.run(
			repository.repositoryId,
			runDate,
			repository.stars,
			repository.forks,
			repository.openIssues,
			repository.updatedAt,
			repository.pushedAt,
		);
}

function loadBaselines(
	database: DatabaseSync,
	repositoryIds: number[],
	runDate: string,
): Map<number, RankingBaseline[]> {
	const baselines = new Map<number, RankingBaseline[]>();
	const statement = database.prepare(
		`SELECT captured_date, stars, forks
FROM repository_snapshots
WHERE repository_id = ? AND captured_date < ?
ORDER BY captured_date DESC
LIMIT 31`,
	);
	for (const repositoryId of repositoryIds) {
		const rows = statement.all(repositoryId, runDate) as Array<{
			captured_date: string;
			stars: number;
			forks: number;
		}>;
		baselines.set(
			repositoryId,
			rows.map((row) => ({
				capturedDate: row.captured_date,
				stars: Number(row.stars),
				forks: Number(row.forks),
			})),
		);
	}
	return baselines;
}

function materializeRankings(
	database: DatabaseSync,
	runDate: string,
	repositories: TrackedRepository[],
): void {
	const candidates: RankingCandidate[] = repositories.map((repository) => ({
		repositoryId: repository.repositoryId,
		fullName: repository.fullName,
		stars: repository.stars,
		forks: repository.forks,
		createdAt: repository.createdAt,
	}));
	const rankings = computeRankings({
		capturedDate: runDate,
		candidates,
		baselines: loadBaselines(
			database,
			repositories.map((repository) => repository.repositoryId),
			runDate,
		),
		limit: GITHUB_TRENDING_RANKING_LIMIT,
	});
	const statement = database.prepare(
		`INSERT INTO rankings (
	captured_date, category, rank, repository_id, metric_value, metric_delta, baseline_date
) VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	for (const entries of Object.values(rankings)) {
		for (const entry of entries) {
			statement.run(
				runDate,
				entry.category,
				entry.rank,
				entry.repositoryId,
				entry.metricValue,
				entry.metricDelta,
				entry.baselineDate,
			);
		}
	}
}

function markUnavailableRepositories(
	database: DatabaseSync,
	nodeIds: string[],
	runDate: string,
): void {
	const statement = database.prepare(
		"UPDATE repositories SET is_unavailable = 1, last_seen_at = ? WHERE node_id = ? AND is_unavailable = 0",
	);
	for (const nodeId of nodeIds) statement.run(runDate, nodeId);
}

function deleteExpiredHistory(database: DatabaseSync, runDate: string): void {
	const cutoffDate = subtractDays(runDate, GITHUB_TRENDING_RETENTION_DAYS);
	database
		.prepare("DELETE FROM rankings WHERE captured_date < ?")
		.run(cutoffDate);
	database
		.prepare("DELETE FROM repository_snapshots WHERE captured_date < ?")
		.run(cutoffDate);
	database
		.prepare(
			"DELETE FROM tracking_sources WHERE track_until IS NOT NULL AND track_until < ?",
		)
		.run(runDate);
}

function describeCollectionError(error: unknown): string {
	if (error instanceof Error) {
		if (/GitHub request failed with status \d+/.test(error.message)) {
			return error.message;
		}
		if (error.name === "AbortError") return "GitHub request timed out";
	}
	return "GitHub Trending collection failed";
}

export async function collectGitHubTrending(
	input: CollectGitHubTrendingInput,
): Promise<CollectionResult> {
	const lease = acquireCollectionRun(input.database, {
		runDate: input.runDate,
		leaseToken: input.leaseToken,
		now: input.now,
		leaseDurationMs: GITHUB_TRENDING_LEASE_DURATION_MS,
	});
	if (lease.outcome === "already_completed") {
		return {
			outcome: "already_completed",
			candidateCount: 0,
			snapshotCount: 0,
		};
	}

	try {
		const discovered = await input.client.discoverRepositories(input.runDate);
		const discoveredNodeIds = new Set(
			discovered.map((repository) => repository.nodeId),
		);
		const nodeIdsToRefresh = loadTrackedRepositories(
			input.database,
			input.runDate,
		)
			.map((repository) => repository.node_id)
			.filter((nodeId) => !discoveredNodeIds.has(nodeId));
		const refreshed = nodeIdsToRefresh.length
			? await input.client.refreshRepositories(nodeIdsToRefresh)
			: { repositories: [], unavailableNodeIds: [] };
		const repositories = mergeRepositories(discovered, refreshed.repositories);

		input.database.exec("BEGIN IMMEDIATE");
		try {
			for (const repository of repositories) {
				upsertRepository(input.database, repository, input.runDate);
				upsertTrackingSources(input.database, repository);
				insertSnapshot(input.database, repository, input.runDate);
			}
			markUnavailableRepositories(
				input.database,
				refreshed.unavailableNodeIds,
				input.runDate,
			);
			materializeRankings(input.database, input.runDate, repositories);
			deleteExpiredHistory(input.database, input.runDate);
			completeCollectionRun(input.database, {
				runDate: input.runDate,
				leaseToken: input.leaseToken,
				finishedAt: new Date(),
				candidateCount: repositories.length,
				snapshotCount: repositories.length,
			});
			input.database.exec("COMMIT");
		} catch (error) {
			input.database.exec("ROLLBACK");
			throw error;
		}
		return {
			outcome: "completed",
			candidateCount: repositories.length,
			snapshotCount: repositories.length,
		};
	} catch (error) {
		failCollectionRun(input.database, {
			runDate: input.runDate,
			leaseToken: input.leaseToken,
			finishedAt: new Date(),
			errorSummary: describeCollectionError(error),
		});
		throw new Error("GitHub Trending collection failed", { cause: error });
	}
}
