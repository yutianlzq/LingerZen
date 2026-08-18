import {
	GITHUB_API_VERSION,
	GITHUB_GRAPHQL_API_URL,
	GITHUB_SEARCH_API_URL,
	GITHUB_TRENDING_DISCOVERY_PAGES,
	GITHUB_TRENDING_GRAPHQL_BATCH_SIZE,
	GITHUB_TRENDING_MAX_ATTEMPTS,
	GITHUB_TRENDING_REQUEST_TIMEOUT_MS,
	GITHUB_TRENDING_SEARCH_PAGE_SIZE,
	GITHUB_TRENDING_TRACKING_DAYS,
	GITHUB_TRENDING_USER_AGENT,
	type GitHubTrendingSource,
} from "@/config/githubTrendingConfig";

export type GitHubFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type TrackingSource = {
	source: GitHubTrendingSource;
	lastDiscoveredAt: string;
	trackUntil: string | null;
};

export type TrackedRepository = {
	repositoryId: number;
	nodeId: string;
	name: string;
	fullName: string;
	ownerLogin: string;
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
	stars: number;
	forks: number;
	openIssues: number;
	trackingSources: TrackingSource[];
};

export type RefreshRepositoriesResult = {
	repositories: TrackedRepository[];
	unavailableNodeIds: string[];
};

type CreateGitHubClientOptions = {
	token: string;
	fetchImpl?: GitHubFetch;
	sleep?: (delayMs: number) => Promise<void>;
	discoveryPages?: number;
	graphQlBatchSize?: number;
};

type SearchItem = {
	id?: unknown;
	node_id?: unknown;
	name?: unknown;
	full_name?: unknown;
	owner?: { login?: unknown; avatar_url?: unknown } | null;
	description?: unknown;
	homepage?: unknown;
	language?: unknown;
	topics?: unknown;
	license?: { spdx_id?: unknown } | null;
	created_at?: unknown;
	updated_at?: unknown;
	pushed_at?: unknown;
	archived?: unknown;
	stargazers_count?: unknown;
	forks_count?: unknown;
	open_issues_count?: unknown;
};

type GraphQlRepository = {
	databaseId?: unknown;
	id?: unknown;
	name?: unknown;
	nameWithOwner?: unknown;
	owner?: { login?: unknown; avatarUrl?: unknown } | null;
	description?: unknown;
	primaryLanguage?: { name?: unknown } | null;
	repositoryTopics?: {
		nodes?: Array<{ topic?: { name?: unknown } } | null>;
	} | null;
	homepageUrl?: unknown;
	licenseInfo?: { spdxId?: unknown } | null;
	createdAt?: unknown;
	updatedAt?: unknown;
	pushedAt?: unknown;
	isArchived?: unknown;
	stargazerCount?: unknown;
	forkCount?: unknown;
	issues?: { totalCount?: unknown } | null;
};

type DiscoverySpec = {
	source: GitHubTrendingSource;
	query: (runDate: string) => string;
	sort: "stars" | "forks" | "updated";
};

const DISCOVERY_SPECS: DiscoverySpec[] = [
	{ source: "top_stars", query: () => "stars:>=1", sort: "stars" },
	{ source: "top_forks", query: () => "forks:>=1", sort: "forks" },
	{
		source: "recent_created",
		query: (runDate) => `created:>=${subtractDays(runDate, 30)} stars:>=10`,
		sort: "stars",
	},
	{
		source: "recent_active",
		query: (runDate) => `pushed:>=${subtractDays(runDate, 14)} stars:>=100`,
		sort: "updated",
	},
];

const GRAPHQL_QUERY = `
query TrendingRepositories($ids: [ID!]!) {
	nodes(ids: $ids) {
		... on Repository {
			databaseId
			id
			name
			nameWithOwner
			owner { login avatarUrl }
			description
			primaryLanguage { name }
			repositoryTopics(first: 20) { nodes { topic { name } } }
			homepageUrl
			licenseInfo { spdxId }
			createdAt
			updatedAt
			pushedAt
			isArchived
			stargazerCount
			forkCount
			issues(states: OPEN) { totalCount }
		}
	}
	rateLimit { remaining resetAt }
}`;

function subtractDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() - days);
	return parsed.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
	const parsed = new Date(`${date}T00:00:00.000Z`);
	parsed.setUTCDate(parsed.getUTCDate() + days);
	return parsed.toISOString().slice(0, 10);
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

function normalizeExternalUrl(value: unknown): string | null {
	const raw = asString(value);
	if (!raw) return null;
	try {
		const parsed = new URL(raw);
		return parsed.protocol === "http:" || parsed.protocol === "https:"
			? parsed.href
			: null;
	} catch {
		return null;
	}
}

function normalizeTopics(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return Array.from(
		new Set(
			value
				.map(asString)
				.filter((topic): topic is string => topic !== null)
				.slice(0, 20),
		),
	);
}

function normalizeSearchItem(
	item: SearchItem,
	source: GitHubTrendingSource,
	runDate: string,
): TrackedRepository | null {
	const repositoryId = asNonNegativeInteger(item.id);
	const nodeId = asString(item.node_id);
	const name = asString(item.name);
	const fullName = asString(item.full_name);
	const ownerLogin = asString(item.owner?.login);
	const createdAt = asString(item.created_at);
	const stars = asNonNegativeInteger(item.stargazers_count);
	const forks = asNonNegativeInteger(item.forks_count);
	const openIssues = asNonNegativeInteger(item.open_issues_count);
	if (
		repositoryId === null ||
		!nodeId ||
		!name ||
		!fullName ||
		!ownerLogin ||
		!createdAt ||
		stars === null ||
		forks === null ||
		openIssues === null
	) {
		return null;
	}
	return {
		repositoryId,
		nodeId,
		name,
		fullName,
		ownerLogin,
		ownerAvatarUrl: normalizeExternalUrl(item.owner?.avatar_url),
		description: asString(item.description),
		language: asString(item.language),
		topics: normalizeTopics(item.topics),
		homepageUrl: normalizeExternalUrl(item.homepage),
		licenseSpdxId: asString(item.license?.spdx_id),
		createdAt,
		updatedAt: asString(item.updated_at),
		pushedAt: asString(item.pushed_at),
		isArchived: item.archived === true,
		stars,
		forks,
		openIssues,
		trackingSources: [
			{
				source,
				lastDiscoveredAt: runDate,
				trackUntil:
					source === "top_stars" || source === "top_forks"
						? null
						: addDays(runDate, GITHUB_TRENDING_TRACKING_DAYS),
			},
		],
	};
}

function normalizeGraphQlRepository(
	node: GraphQlRepository,
): TrackedRepository | null {
	const repositoryId = asNonNegativeInteger(node.databaseId);
	const nodeId = asString(node.id);
	const name = asString(node.name);
	const fullName = asString(node.nameWithOwner);
	const ownerLogin = asString(node.owner?.login);
	const createdAt = asString(node.createdAt);
	const stars = asNonNegativeInteger(node.stargazerCount);
	const forks = asNonNegativeInteger(node.forkCount);
	const openIssues = asNonNegativeInteger(node.issues?.totalCount);
	if (
		repositoryId === null ||
		!nodeId ||
		!name ||
		!fullName ||
		!ownerLogin ||
		!createdAt ||
		stars === null ||
		forks === null ||
		openIssues === null
	) {
		return null;
	}
	const topicNodes = node.repositoryTopics?.nodes ?? [];
	return {
		repositoryId,
		nodeId,
		name,
		fullName,
		ownerLogin,
		ownerAvatarUrl: normalizeExternalUrl(node.owner?.avatarUrl),
		description: asString(node.description),
		language: asString(node.primaryLanguage?.name),
		topics: normalizeTopics(
			topicNodes.map((topicNode) => topicNode?.topic?.name),
		),
		homepageUrl: normalizeExternalUrl(node.homepageUrl),
		licenseSpdxId: asString(node.licenseInfo?.spdxId),
		createdAt,
		updatedAt: asString(node.updatedAt),
		pushedAt: asString(node.pushedAt),
		isArchived: node.isArchived === true,
		stars,
		forks,
		openIssues,
		trackingSources: [],
	};
}

function mergeRepository(
	current: TrackedRepository,
	incoming: TrackedRepository,
): TrackedRepository {
	const sources = new Map(
		current.trackingSources.map((source) => [source.source, source]),
	);
	for (const source of incoming.trackingSources)
		sources.set(source.source, source);
	return { ...incoming, trackingSources: Array.from(sources.values()) };
}

function chunk<T>(values: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseRetryAfter(value: string | null): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds > 0) return seconds * 1_000;
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return null;
	return Math.max(1_000, timestamp - Date.now());
}

function isTransientNetworkError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "AbortError" || error instanceof TypeError)
	);
}

export function createGitHubTrendingClient(
	options: CreateGitHubClientOptions,
): {
	discoverRepositories: (runDate: string) => Promise<TrackedRepository[]>;
	refreshRepositories: (
		nodeIds: string[],
	) => Promise<RefreshRepositoriesResult>;
} {
	const token = options.token.trim();
	if (!token) throw new Error("GitHub Trending token is required");
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleep = options.sleep ?? defaultSleep;
	const discoveryPages = Math.min(
		10,
		Math.max(1, options.discoveryPages ?? GITHUB_TRENDING_DISCOVERY_PAGES),
	);
	const graphQlBatchSize = Math.min(
		100,
		Math.max(1, options.graphQlBatchSize ?? GITHUB_TRENDING_GRAPHQL_BATCH_SIZE),
	);

	async function requestJson(
		url: URL,
		init: RequestInit,
	): Promise<Record<string, unknown>> {
		for (
			let attempt = 1;
			attempt <= GITHUB_TRENDING_MAX_ATTEMPTS;
			attempt += 1
		) {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				GITHUB_TRENDING_REQUEST_TIMEOUT_MS,
			);
			try {
				const response = await fetchImpl(url, {
					...init,
					headers: {
						Accept: "application/vnd.github+json",
						Authorization: `Bearer ${token}`,
						"User-Agent": GITHUB_TRENDING_USER_AGENT,
						"X-GitHub-Api-Version": GITHUB_API_VERSION,
						...init.headers,
					},
					signal: controller.signal,
				});
				if (response.ok) {
					return (await response.json()) as Record<string, unknown>;
				}
				const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
				const remaining = response.headers.get("X-RateLimit-Remaining");
				const isRateLimited =
					response.status === 429 ||
					(response.status === 403 &&
						(retryAfter !== null || remaining === "0"));
				const canRetry = isRateLimited || response.status >= 500;
				if (canRetry && attempt < GITHUB_TRENDING_MAX_ATTEMPTS) {
					await sleep(retryAfter ?? 2 ** (attempt - 1) * 1_000);
					continue;
				}
				throw new Error(`GitHub request failed with status ${response.status}`);
			} catch (error) {
				if (
					attempt < GITHUB_TRENDING_MAX_ATTEMPTS &&
					isTransientNetworkError(error)
				) {
					await sleep(2 ** (attempt - 1) * 1_000);
					continue;
				}
				if (isTransientNetworkError(error)) {
					throw new Error(
						"GitHub request failed after transient network errors",
					);
				}
				throw error;
			} finally {
				clearTimeout(timeout);
			}
		}
		throw new Error("GitHub request exhausted retries");
	}

	async function discoverRepositories(
		runDate: string,
	): Promise<TrackedRepository[]> {
		const repositories = new Map<number, TrackedRepository>();
		for (const spec of DISCOVERY_SPECS) {
			for (let page = 1; page <= discoveryPages; page += 1) {
				const url = new URL(GITHUB_SEARCH_API_URL);
				url.searchParams.set("q", spec.query(runDate));
				url.searchParams.set("sort", spec.sort);
				url.searchParams.set("order", "desc");
				url.searchParams.set(
					"per_page",
					String(GITHUB_TRENDING_SEARCH_PAGE_SIZE),
				);
				url.searchParams.set("page", String(page));
				const data = await requestJson(url, { method: "GET" });
				const items = Array.isArray(data.items) ? data.items : [];
				for (const item of items) {
					if (!item || typeof item !== "object") continue;
					const normalized = normalizeSearchItem(
						item as SearchItem,
						spec.source,
						runDate,
					);
					if (!normalized) continue;
					const existing = repositories.get(normalized.repositoryId);
					repositories.set(
						normalized.repositoryId,
						existing ? mergeRepository(existing, normalized) : normalized,
					);
				}
			}
		}
		return Array.from(repositories.values()).sort(
			(left, right) => left.repositoryId - right.repositoryId,
		);
	}

	async function refreshRepositories(
		nodeIds: string[],
	): Promise<RefreshRepositoriesResult> {
		const repositories: TrackedRepository[] = [];
		const unavailableNodeIds: string[] = [];
		for (const nodeIdBatch of chunk(nodeIds, graphQlBatchSize)) {
			const data = await requestJson(new URL(GITHUB_GRAPHQL_API_URL), {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					query: GRAPHQL_QUERY,
					variables: { ids: nodeIdBatch },
				}),
			});
			const graphData =
				data.data && typeof data.data === "object"
					? (data.data as Record<string, unknown>)
					: null;
			const nodes = graphData?.nodes;
			if (!Array.isArray(nodes) || nodes.length !== nodeIdBatch.length) {
				throw new Error("GraphQL repository refresh failed");
			}
			for (let index = 0; index < nodeIdBatch.length; index += 1) {
				const node = nodes[index];
				if (node === null) {
					const unavailable = nodeIdBatch[index];
					if (unavailable) unavailableNodeIds.push(unavailable);
					continue;
				}
				if (!node || typeof node !== "object") {
					throw new Error("GraphQL repository refresh failed");
				}
				const normalized = normalizeGraphQlRepository(
					node as GraphQlRepository,
				);
				if (!normalized) {
					throw new Error("GraphQL repository refresh failed");
				}
				repositories.push(normalized);
			}
		}
		return { repositories, unavailableNodeIds };
	}

	return { discoverRepositories, refreshRepositories };
}
