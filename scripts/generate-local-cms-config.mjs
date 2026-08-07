import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourcePath = resolve(projectRoot, "public/admin/config.yml");
const targetPath = resolve(projectRoot, "public/admin/config.local.yml");
const envPath = resolve(projectRoot, ".env.local");
const defaultBaseUrl = "http://localhost:4321";

const source = await readFile(sourcePath, "utf8");
const baseUrlPattern = /^(\s*base_url:\s*).+$/m;

if (!baseUrlPattern.test(source)) {
	throw new Error(`CMS 配置缺少 base_url：${sourcePath}`);
}

let localBaseUrl = process.env.PUBLIC_SITE_URL || defaultBaseUrl;
try {
	const env = await readFile(envPath, "utf8");
	const match = env.match(/^PUBLIC_SITE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);
	if (match?.[1]) localBaseUrl = match[1];
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

const localConfig = source.replace(baseUrlPattern, `$1${localBaseUrl}`);
await writeFile(targetPath, localConfig, "utf8");
console.log(`Generated ${targetPath} with base_url ${localBaseUrl}`);
