import assert from "node:assert/strict";
import test from "node:test";
import {
	createGitHubTrendingClient,
	type GitHubFetch,
} from "../../src/lib/github-trending/github-client";

function repository(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		node_id: `R_${id}`,
		name: `repository-${id}`,
		full_name: `owner/repository-${id}`,
		owner: {
			login: "owner",
			avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
		},
		description: `Repository ${id}`,
		html_url: `https://github.com/owner/repository-${id}`,
		homepage: "https://example.com/project",
		language: "TypeScript",
		topics: ["astro", "trending"],
		license: { spdx_id: "MIT" },
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-18T00:00:00Z",
		pushed_at: "2026-08-18T00:00:00Z",
		archived: false,
		stargazers_count: 100 + id,
		forks_count: 10 + id,
		open_issues_count: id,
		...overrides,
	};
}

test("discovers paged candidates and merges tracking sources by repository id", async () => {
	const requests: URL[] = [];
	const fetchImpl: GitHubFetch = async (input) => {
		const url = new URL(String(input));
		requests.push(url);
		const sort = url.searchParams.get("sort");
		const page = Number(url.searchParams.get("page"));
		const query = url.searchParams.get("q") ?? "";
		let items: unknown[] = [];
		if (page === 1 && sort === "stars" && query.includes("created:")) {
			items = [
				repository(1),
				repository(3, { homepage: "javascript:alert(1)" }),
			];
		} else if (page === 1 && sort === "stars") {
			items = [repository(1)];
		} else if (page === 1 && sort === "forks") {
			items = [repository(1), repository(2)];
		} else if (page === 1 && sort === "updated") {
			items = [repository(4)];
		}
		return new Response(JSON.stringify({ items }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	};
	const client = createGitHubTrendingClient({
		token: "test-token",
		fetchImpl,
		sleep: async () => {},
	});

	const candidates = await client.discoverRepositories("2026-08-18");

	assert.equal(requests.length, 8);
	assert.deepEqual(
		requests.map((request) => request.searchParams.get("page")),
		["1", "2", "1", "2", "1", "2", "1", "2"],
	);
	assert.deepEqual(
		candidates.map((candidate) => candidate.repositoryId),
		[1, 2, 3, 4],
	);
	assert.deepEqual(
		candidates[0]?.trackingSources.map((source) => source.source).sort(),
		["recent_created", "top_forks", "top_stars"],
	);
	assert.equal(candidates[2]?.homepageUrl, null);
	assert.ok(
		requests.every((request) => request.origin === "https://api.github.com"),
	);
});

test("retries rate-limited requests without leaking upstream response bodies", async () => {
	let calls = 0;
	const delays: number[] = [];
	const fetchImpl: GitHubFetch = async () => {
		calls += 1;
		if (calls === 1) {
			return new Response("secret upstream diagnostic", {
				status: 429,
				headers: { "Retry-After": "1" },
			});
		}
		return new Response(JSON.stringify({ items: [] }), { status: 200 });
	};
	const client = createGitHubTrendingClient({
		token: "test-token",
		fetchImpl,
		sleep: async (delayMs) => {
			delays.push(delayMs);
		},
		discoveryPages: 1,
	});

	await client.discoverRepositories("2026-08-18");
	assert.equal(calls, 5);
	assert.deepEqual(delays, [1_000]);

	const unauthorized = createGitHubTrendingClient({
		token: "test-token",
		fetchImpl: async () =>
			new Response("token=test-token and private details", { status: 401 }),
		sleep: async () => {},
		discoveryPages: 1,
	});
	await assert.rejects(
		unauthorized.discoverRepositories("2026-08-18"),
		(error: Error) =>
			/GitHub request failed with status 401/.test(error.message) &&
			!error.message.includes("test-token") &&
			!error.message.includes("private details"),
	);
});

test("retries secondary rate limits and transient network failures", async () => {
	let calls = 0;
	const delays: number[] = [];
	const retryAt = new Date(Date.now() + 2_000).toUTCString();
	const client = createGitHubTrendingClient({
		token: "test-token",
		fetchImpl: async () => {
			calls += 1;
			if (calls === 1) {
				return new Response("secondary limit", {
					status: 403,
					headers: { "Retry-After": retryAt },
				});
			}
			if (calls === 2) throw new TypeError("fetch failed");
			return new Response(JSON.stringify({ items: [] }), { status: 200 });
		},
		sleep: async (delayMs) => {
			delays.push(delayMs);
		},
		discoveryPages: 1,
	});

	await client.discoverRepositories("2026-08-18");
	assert.equal(calls, 6);
	assert.equal(delays.length, 2);
	assert.ok(delays[0] !== undefined && delays[0] >= 1_000);
	assert.equal(delays[1], 2_000);
});

test("rejects GraphQL batch failures instead of marking every node unavailable", async () => {
	const client = createGitHubTrendingClient({
		token: "test-token",
		fetchImpl: async () =>
			new Response(
				JSON.stringify({
					data: null,
					errors: [
						{ message: "Something went wrong while executing your query" },
					],
				}),
				{ status: 200 },
			),
		sleep: async () => {},
	});

	await assert.rejects(
		client.refreshRepositories(["R_1", "R_2"]),
		/GraphQL repository refresh failed/,
	);
});

test("refreshes tracked repositories in GraphQL batches and reports unavailable nodes", async () => {
	const batchSizes: number[] = [];
	const fetchImpl: GitHubFetch = async (_input, init) => {
		const body = JSON.parse(String(init?.body)) as {
			variables: { ids: string[] };
		};
		batchSizes.push(body.variables.ids.length);
		const nodes = body.variables.ids.map((nodeId, index) =>
			nodeId === "R_51"
				? null
				: {
						databaseId: index + 1,
						id: nodeId,
						name: `repository-${index + 1}`,
						nameWithOwner: `owner/repository-${index + 1}`,
						owner: { login: "owner", avatarUrl: null },
						description: null,
						primaryLanguage: { name: "Rust" },
						repositoryTopics: { nodes: [] },
						homepageUrl: null,
						licenseInfo: null,
						createdAt: "2020-01-01T00:00:00Z",
						updatedAt: "2026-08-18T00:00:00Z",
						pushedAt: "2026-08-18T00:00:00Z",
						isArchived: false,
						stargazerCount: 50,
						forkCount: 5,
						issues: { totalCount: 1 },
					},
		);
		return new Response(
			JSON.stringify({
				data: {
					nodes,
					rateLimit: { remaining: 4_000, resetAt: "2026-08-18T01:00:00Z" },
				},
				errors: [{ message: "one repository is unavailable" }],
			}),
			{ status: 200 },
		);
	};
	const client = createGitHubTrendingClient({
		token: "test-token",
		fetchImpl,
		sleep: async () => {},
		graphQlBatchSize: 50,
	});
	const nodeIds = Array.from({ length: 51 }, (_, index) => `R_${index + 1}`);

	const result = await client.refreshRepositories(nodeIds);

	assert.deepEqual(batchSizes, [50, 1]);
	assert.equal(result.repositories.length, 50);
	assert.deepEqual(result.unavailableNodeIds, ["R_51"]);
	assert.equal(result.repositories[0]?.trackingSources.length, 0);
});
