export function isCloudflareWorkers(): boolean {
	const buildFlag = import.meta.env.CF_WORKERS;
	return (
		buildFlag === "1" ||
		buildFlag === "true" ||
		process.env.CF_WORKERS === "1" ||
		process.env.CF_WORKERS === "true"
	);
}
