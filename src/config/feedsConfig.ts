import { XMLParser } from "fast-xml-parser";

export const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
export const FEED_REQUEST_TIMEOUT_MS = 8 * 1000;
export const FEED_MAX_ITEMS = 20;
const ALLOWED_FEED_HOSTS = new Set(["github.blog"]);

export type FeedSource = {
	id: string;
	name: string;
	url: string;
};

export type FeedItem = {
	title: string;
	link: string;
	description: string;
	published: string;
};

export type FeedResult = {
	source: FeedSource;
	items: FeedItem[];
	fetchedAt: string;
	stale: boolean;
	error?: string;
};

export const feedSources: FeedSource[] = [
	{
		id: "github-blog",
		name: "GitHub Blog",
		url: "https://github.blog/feed/",
	},
];

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	trimValues: true,
	processEntities: false,
});

const cache = new Map<
	string,
	{ items: FeedItem[]; fetchedAt: Date; expiresAt: number }
>();

function asArray<T>(value: T | T[] | undefined): T[] {
	return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function asText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (typeof value === "number") return String(value);
	if (value && typeof value === "object" && "#text" in value) {
		return asText(value["#text"]);
	}
	return "";
}

function stripMarkup(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function firstLink(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (Array.isArray(value)) {
		for (const item of value) {
			const link = firstLink(item);
			if (link) return link;
		}
		return "";
	}
	if (value && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const link = record["@_href"] ?? record["#text"];
		return typeof link === "string" ? link.trim() : "";
	}
	return "";
}

function normalizeExternalLink(value: string): string {
	try {
		const link = new URL(value);
		return link.protocol === "http:" || link.protocol === "https:" ? link.href : "";
	} catch {
		return "";
	}
}

function normalizeItem(item: Record<string, unknown>): FeedItem | null {
	const title = stripMarkup(asText(item.title));
	const link = normalizeExternalLink(firstLink(item.link) || asText(item.guid));
	if (!title || !link) return null;

	return {
		title,
		link,
		description: stripMarkup(
			asText(item.description) || asText(item.summary) || asText(item.content),
		),
		published: asText(item.pubDate) || asText(item.published) || asText(item.updated),
	};
}

function parseFeed(xml: string): FeedItem[] {
	const document = parser.parse(xml) as Record<string, unknown>;
	const rss = document.rss as Record<string, unknown> | undefined;
	const channel = rss?.channel as Record<string, unknown> | undefined;
	const atom = document.feed as Record<string, unknown> | undefined;
	const rawItems = channel?.item ?? atom?.entry;

	return asArray(rawItems)
		.map((item) =>
			item && typeof item === "object"
				? normalizeItem(item as Record<string, unknown>)
				: null,
		)
		.filter((item): item is FeedItem => item !== null)
		.slice(0, FEED_MAX_ITEMS);
}

async function requestFeed(source: FeedSource): Promise<FeedItem[]> {
	const sourceUrl = new URL(source.url);
	if (sourceUrl.protocol !== "https:" || !ALLOWED_FEED_HOSTS.has(sourceUrl.hostname)) {
		throw new Error("feed source is not allowed");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FEED_REQUEST_TIMEOUT_MS);
	try {
		const response = await fetch(source.url, {
			headers: {
				Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
				"User-Agent": "yu-tian.net feed proxy",
			},
			signal: controller.signal,
		});
		if (!response.ok) {
			throw new Error(`upstream returned ${response.status}`);
		}
		const items = parseFeed(await response.text());
		if (items.length === 0) throw new Error("upstream feed contains no readable items");
		return items;
	} finally {
		clearTimeout(timeout);
	}
}

export async function getFeed(source: FeedSource): Promise<FeedResult> {
	const previous = cache.get(source.id);
	const now = Date.now();
	if (previous && previous.expiresAt > now) {
		return {
			source,
			items: previous.items,
			fetchedAt: previous.fetchedAt.toISOString(),
			stale: false,
		};
	}

	try {
		const items = await requestFeed(source);
		const fetchedAt = new Date();
		cache.set(source.id, {
			items,
			fetchedAt,
			expiresAt: fetchedAt.getTime() + FEED_CACHE_TTL_MS,
		});
		return {
			source,
			items,
			fetchedAt: fetchedAt.toISOString(),
			stale: false,
		};
	} catch (error) {
		if (previous) {
			return {
				source,
				items: previous.items,
				fetchedAt: previous.fetchedAt.toISOString(),
				stale: true,
				error: error instanceof Error ? error.message : "upstream request failed",
			};
		}
		return {
			source,
			items: [],
			fetchedAt: "",
			stale: false,
			error: error instanceof Error ? error.message : "upstream request failed",
		};
	}
}

export async function getAllFeeds(): Promise<FeedResult[]> {
	return Promise.all(feedSources.map(getFeed));
}
