import type { APIRoute } from "astro";
import { isCloudflareWorkers } from "@/lib/github-trending/environment";
import {
	getCollectionRunDate,
	isAuthorizedCollectionRequest,
} from "@/lib/github-trending/internal-auth";
import { getTrendingRuntime } from "@/lib/github-trending/runtime";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
	return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export const POST: APIRoute = async (context) => {
	if (isCloudflareWorkers()) {
		return jsonResponse({ error: "collection is not available" }, 501);
	}
	const collectionSecret =
		process.env.GITHUB_TRENDING_COLLECTION_SECRET?.trim() ?? "";
	if (
		!isAuthorizedCollectionRequest(
			context.request,
			context.clientAddress,
			collectionSecret,
		)
	) {
		return jsonResponse({ error: "not found" }, 404);
	}
	const token = process.env.GITHUB_TRENDING_TOKEN?.trim() ?? "";
	if (!token) {
		return jsonResponse({ error: "collection is not configured" }, 503);
	}
	const runtime = await getTrendingRuntime();
	if (!runtime.database) {
		return jsonResponse({ error: "collection is unavailable" }, 503);
	}
	const now = new Date();
	const runDate = getCollectionRunDate(now);
	try {
		const [
			{ randomUUID },
			{ collectGitHubTrending },
			{ createGitHubTrendingClient },
		] = await Promise.all([
			import("node:crypto"),
			import("@/lib/github-trending/collector"),
			import("@/lib/github-trending/github-client"),
		]);
		const result = await collectGitHubTrending({
			database: runtime.database,
			client: createGitHubTrendingClient({ token }),
			runDate,
			now,
			leaseToken: randomUUID(),
		});
		return jsonResponse({ runDate, ...result });
	} catch {
		return jsonResponse({ error: "collection failed", runDate }, 502);
	}
};
