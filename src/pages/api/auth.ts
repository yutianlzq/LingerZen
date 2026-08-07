import type { APIRoute } from "astro";
import { siteConfig } from "@/config";

const STATE_COOKIE = "__Host-decap_oauth_state";
const LOCAL_STATE_COOKIE = "decap_oauth_state";
const STATE_MAX_AGE_SECONDS = 10 * 60;
const AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";

function getStateCookieName() {
	return new URL(siteConfig.site_url).protocol === "https:"
		? STATE_COOKIE
		: LOCAL_STATE_COOKIE;
}

function getClientId() {
	return process.env.GITHUB_CLIENT_ID || process.env.GITHUB_OAUTH_CLIENT_ID;
}

function serializeForScript(value: string) {
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026");
}

function renderAuthorizationPage(authorizationUrl: string) {
	const targetOrigin = new URL(siteConfig.site_url).origin;
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GitHub OAuth</title></head><body><script>const openerOrigin=${serializeForScript(targetOrigin)};const authorizationUrl=${serializeForScript(authorizationUrl)};if(window.opener){window.opener.postMessage("authorizing:github",openerOrigin);window.addEventListener("message",(event)=>{if(event.origin===openerOrigin&&event.source===window.opener&&event.data==="authorizing:github"){window.location.replace(authorizationUrl);}},false);}else{document.body.textContent="This window must be opened by Decap CMS.";}</script><p>Connecting to GitHub…</p></body></html>`,
		{
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			},
		},
	);
}

export const GET: APIRoute = ({ cookies, url }) => {
	const clientId = getClientId();
	if (!clientId) {
		return new Response("GitHub OAuth is not configured", { status: 503 });
	}

	const provider = url.searchParams.get("provider");
	if (provider !== "github") {
		return new Response("Unsupported OAuth provider", { status: 400 });
	}

	const state = crypto.randomUUID();
	cookies.set(getStateCookieName(), state, {
		httpOnly: true,
		secure: new URL(siteConfig.site_url).protocol === "https:",
		sameSite: "lax",
		path: "/",
		maxAge: STATE_MAX_AGE_SECONDS,
	});

	const requestedScope = url.searchParams.get("scope") || "repo";
	const scope = requestedScope === "public_repo" ? "public_repo" : "repo";
	const redirectUri = new URL("/api/callback", siteConfig.site_url).toString();
	const authorizationUrl = new URL(AUTHORIZATION_ENDPOINT);
	authorizationUrl.searchParams.set("client_id", clientId);
	authorizationUrl.searchParams.set("redirect_uri", redirectUri);
	authorizationUrl.searchParams.set("scope", scope);
	authorizationUrl.searchParams.set("state", state);

	return renderAuthorizationPage(authorizationUrl.toString());
};
