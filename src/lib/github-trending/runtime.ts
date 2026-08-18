import type { DatabaseSync } from "node:sqlite";
import { isCloudflareWorkers } from "./environment";

export type TrendingRuntime =
	| { status: "ready"; database: DatabaseSync }
	| { status: "disabled" | "unavailable"; database: null };

let databasePromise: Promise<TrendingRuntime> | null = null;

async function createRuntime(): Promise<TrendingRuntime> {
	if (isCloudflareWorkers()) return { status: "disabled", database: null };
	try {
		const [{ resolve }, { openTrendingDatabase }] = await Promise.all([
			import("node:path"),
			import("./database"),
		]);
		const configuredPath = process.env.GITHUB_TRENDING_DB_PATH?.trim();
		const databasePath = configuredPath
			? resolve(configuredPath)
			: resolve("data/github-trending/trending.sqlite");
		return {
			status: "ready",
			database: openTrendingDatabase(databasePath),
		};
	} catch {
		return { status: "unavailable", database: null };
	}
}

export function getTrendingRuntime(): Promise<TrendingRuntime> {
	databasePromise ??= createRuntime();
	return databasePromise;
}
