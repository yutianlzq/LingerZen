import type { APIRoute } from "astro";
import { getAllFeeds } from "@/config/feedsConfig";

export const GET: APIRoute = async () => {
	const feeds = await getAllFeeds();
	const hasItems = feeds.some((feed) => feed.items.length > 0);

	return new Response(JSON.stringify({ feeds }), {
		status: hasItems ? 200 : 502,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
		},
	});
};
