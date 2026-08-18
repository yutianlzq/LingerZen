import assert from "node:assert/strict";
import test from "node:test";
import {
	getCollectionRunDate,
	isAuthorizedCollectionRequest,
} from "../../src/lib/github-trending/internal-auth";

const secret = "0123456789abcdef0123456789abcdef";

function request(
	url: string,
	token?: string,
	extraHeaders: HeadersInit = {},
): Request {
	const headers = new Headers(extraHeaders);
	if (token) headers.set("Authorization", `Bearer ${token}`);
	return new Request(url, { method: "POST", headers });
}

test("authorizes only direct loopback requests with a matching bearer secret", () => {
	assert.equal(
		isAuthorizedCollectionRequest(
			request(
				"http://public.example/api/internal/github-trending/collect",
				secret,
			),
			"127.0.0.1",
			secret,
		),
		true,
	);
	assert.equal(
		isAuthorizedCollectionRequest(
			request(
				"http://127.0.0.1:4321/api/internal/github-trending/collect",
				secret,
			),
			"203.0.113.10",
			secret,
		),
		false,
	);
	assert.equal(
		isAuthorizedCollectionRequest(
			request(
				"http://127.0.0.1:4321/api/internal/github-trending/collect",
				secret,
				{ "X-Forwarded-For": "127.0.0.1" },
			),
			"127.0.0.1",
			secret,
		),
		false,
	);
	assert.equal(
		isAuthorizedCollectionRequest(
			request(
				"http://localhost:4321/api/internal/github-trending/collect",
				secret,
			),
			"::ffff:127.0.0.1",
			secret,
		),
		true,
	);
	assert.equal(
		isAuthorizedCollectionRequest(
			request("http://127.0.0.1:4321/api/internal/github-trending/collect"),
			"127.0.0.1",
			secret,
		),
		false,
	);
	assert.equal(
		isAuthorizedCollectionRequest(
			request(
				"http://127.0.0.1:4321/api/internal/github-trending/collect",
				"wrong",
			),
			"127.0.0.1",
			secret,
		),
		false,
	);
	assert.equal(
		isAuthorizedCollectionRequest(
			request(
				"http://127.0.0.1:4321/api/internal/github-trending/collect",
				secret,
			),
			"127.0.0.1",
			"short",
		),
		false,
	);
});

test("derives the collection date in Asia Shanghai", () => {
	assert.equal(
		getCollectionRunDate(new Date("2026-08-17T20:17:00.000Z")),
		"2026-08-18",
	);
	assert.equal(
		getCollectionRunDate(new Date("2026-08-18T15:59:59.000Z")),
		"2026-08-18",
	);
});
