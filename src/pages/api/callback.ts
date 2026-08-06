import type { APIRoute } from "astro";
import { siteConfig } from "@/config";

const STATE_COOKIE = "__Host-decap_oauth_state";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const TOKEN_REQUEST_TIMEOUT_MS = 10 * 1000;
const AUTH_MESSAGE_PREFIX = "authorization:github";

function getClientId() {
	return process.env.GITHUB_CLIENT_ID || process.env.GITHUB_OAUTH_CLIENT_ID;
}

function getClientSecret() {
	return process.env.GITHUB_CLIENT_SECRET || process.env.GITHUB_OAUTH_CLIENT_SECRET;
}

function serializeForScript(value: string) {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026");
}

function renderResult(message: string) {
	const targetOrigin = new URL(siteConfig.site_url).origin;
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GitHub OAuth</title></head><body><script>window.opener?.postMessage(${serializeForScript(message)}, ${serializeForScript(targetOrigin)}); window.close();</script><p>Authentication complete. You can close this window.</p></body></html>`,
		{
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			},
		},
	);
}

function renderError(message: string) {
	return renderResult(
		`${AUTH_MESSAGE_PREFIX}:error:${JSON.stringify({ message })}`,
	);
}

export const GET: APIRoute = async ({ cookies, url }) => {
	const clientId = getClientId();
	const clientSecret = getClientSecret();
	const state = url.searchParams.get("state");
	const code = url.searchParams.get("code");
	const expectedState = cookies.get(STATE_COOKIE)?.value;

	if (!clientId || !clientSecret) {
		return renderError("GitHub OAuth is unavailable");
	}
	if (!state || !expectedState || state !== expectedState) {
		return renderError("Invalid OAuth state");
	}
	if (!code) {
		return renderError("GitHub did not return an authorization code");
	}

	cookies.delete(STATE_COOKIE, { path: "/" });

	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		TOKEN_REQUEST_TIMEOUT_MS,
	);

	try {
		const response = await fetch(TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			signal: controller.signal,
			body: JSON.stringify({
				client_id: clientId,
				client_secret: clientSecret,
				code,
				redirect_uri: new URL("/api/callback", siteConfig.site_url).toString(),
				state,
			}),
		});
		const data = (await response.json()) as {
			access_token?: string;
			error?: string;
			error_description?: string;
		};

		if (!response.ok || !data.access_token) {
			console.error(
				"[OAuth] GitHub token exchange rejected:",
				data.error_description ?? data.error ?? `HTTP ${response.status}`,
			);
			return renderError("GitHub OAuth authorization failed");
		}

		return renderResult(
			`${AUTH_MESSAGE_PREFIX}:success:${JSON.stringify({
				token: data.access_token,
				provider: "github",
			})}`,
		);
	} catch (error) {
		console.error(
			"[OAuth] GitHub token exchange failed:",
			error instanceof Error ? error.message : error,
		);
		return renderError("GitHub OAuth request failed");
	} finally {
		clearTimeout(timeout);
	}
};
