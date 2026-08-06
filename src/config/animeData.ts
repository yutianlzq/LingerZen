export const BILIBILI_CACHE_TTL_MS = 10 * 60 * 1000;
export const BILIBILI_REQUEST_TIMEOUT_MS = 8 * 1000;

export type BilibiliItem = {
	media_id: number;
	title: string;
	cover?: string;
	season_type?: number;
	season_type_name?: string;
	rating?: { score?: number };
	evaluate?: string;
	brief?: string;
	season_id: number;
	new_ep?: { index_show?: string };
};

type BilibiliResponse = {
	code?: number;
	data?: {
		list?: BilibiliItem[];
		total?: number;
	};
};

type BilibiliCacheEntry = {
	items: BilibiliItem[];
	expiresAt: number;
};

const cache = new Map<string, BilibiliCacheEntry>();
const requests = new Map<string, Promise<BilibiliItem[]>>();

async function fetchBilibiliJson(url: string): Promise<BilibiliResponse> {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		BILIBILI_REQUEST_TIMEOUT_MS,
	);
	try {
		const response = await fetch(url, { signal: controller.signal });
		if (!response.ok) throw new Error(`Bilibili returned ${response.status}`);
		return (await response.json()) as BilibiliResponse;
	} finally {
		clearTimeout(timeout);
	}
}

async function fetchBilibiliByType(
	uid: string,
	type: number,
): Promise<BilibiliItem[]> {
	const pageSize = 30;
	const firstJson = await fetchBilibiliJson(
		`https://api.bilibili.com/x/space/bangumi/follow/list?type=${type}&vmid=${uid}&pn=1&ps=${pageSize}`,
	);
	if (firstJson.code !== 0 || !firstJson.data?.list?.length) return [];

	const items = [...firstJson.data.list];
	const total = firstJson.data.total || items.length;
	const totalPages = Math.ceil(total / pageSize);
	if (totalPages <= 1) return items;

	const remaining = await Promise.all(
		Array.from({ length: totalPages - 1 }, (_, index) =>
			fetchBilibiliJson(
				`https://api.bilibili.com/x/space/bangumi/follow/list?type=${type}&vmid=${uid}&pn=${index + 2}&ps=${pageSize}`,
			).then((data) => data.data?.list || []),
		),
	);
	return items.concat(...remaining);
}

async function requestBilibiliItems(uid: string): Promise<BilibiliItem[]> {
	const [animeItems, dramaItems] = await Promise.all([
		fetchBilibiliByType(uid, 1),
		fetchBilibiliByType(uid, 2),
	]);
	const items = [...animeItems, ...dramaItems];
	cache.set(uid, {
		items,
		expiresAt: Date.now() + BILIBILI_CACHE_TTL_MS,
	});
	console.log(
		`[Anime] Fetched ${items.length} items from Bilibili (anime: ${animeItems.length}, drama: ${dramaItems.length}).`,
	);
	return items;
}

export async function getBilibiliItems(uid: string): Promise<BilibiliItem[]> {
	const cached = cache.get(uid);
	if (cached && cached.expiresAt > Date.now()) return cached.items;

	const pending = requests.get(uid);
	if (pending) return pending;

	const request = requestBilibiliItems(uid);
	requests.set(uid, request);
	try {
		return await request;
	} finally {
		requests.delete(uid);
	}
}
