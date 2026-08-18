import { createHash, timingSafeEqual } from "node:crypto";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MIN_SECRET_LENGTH = 32;

function parseBearerToken(request: Request): string | null {
	const authorization = request.headers.get("Authorization");
	if (!authorization?.startsWith("Bearer ")) return null;
	const token = authorization.slice("Bearer ".length).trim();
	return token || null;
}

export function isAuthorizedCollectionRequest(
	request: Request,
	clientAddress: string,
	secret: string,
): boolean {
	if (secret.length < MIN_SECRET_LENGTH) return false;
	if (request.headers.has("X-Forwarded-For")) return false;
	if (!LOOPBACK_ADDRESSES.has(clientAddress)) return false;
	const token = parseBearerToken(request);
	if (!token) return false;
	const expected = createHash("sha256").update(secret).digest();
	const actual = createHash("sha256").update(token).digest();
	return timingSafeEqual(expected, actual);
}

export function getCollectionRunDate(now: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const value = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((part) => part.type === type)?.value ?? "";
	return `${value("year")}-${value("month")}-${value("day")}`;
}
