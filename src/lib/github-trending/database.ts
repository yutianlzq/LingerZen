import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA_VERSION = 1;
const BUSY_TIMEOUT_MS = 5_000;
const MAX_BACKUPS = 5;

const MIGRATION_V1 = `
CREATE TABLE repositories (
	repository_id INTEGER PRIMARY KEY,
	node_id TEXT NOT NULL UNIQUE,
	full_name TEXT NOT NULL UNIQUE,
	owner_login TEXT NOT NULL,
	name TEXT NOT NULL,
	owner_avatar_url TEXT,
	description TEXT,
	language TEXT,
	topics_json TEXT NOT NULL DEFAULT '[]',
	homepage_url TEXT,
	license_spdx_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT,
	pushed_at TEXT,
	is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
	is_unavailable INTEGER NOT NULL DEFAULT 0 CHECK (is_unavailable IN (0, 1)),
	first_seen_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL
);

CREATE TABLE tracking_sources (
	repository_id INTEGER NOT NULL,
	source TEXT NOT NULL,
	last_discovered_at TEXT NOT NULL,
	track_until TEXT,
	PRIMARY KEY (repository_id, source),
	FOREIGN KEY (repository_id) REFERENCES repositories(repository_id) ON DELETE CASCADE
);

CREATE TABLE repository_snapshots (
	repository_id INTEGER NOT NULL,
	captured_date TEXT NOT NULL,
	stars INTEGER NOT NULL CHECK (stars >= 0),
	forks INTEGER NOT NULL CHECK (forks >= 0),
	open_issues INTEGER NOT NULL CHECK (open_issues >= 0),
	updated_at TEXT,
	pushed_at TEXT,
	PRIMARY KEY (repository_id, captured_date),
	FOREIGN KEY (repository_id) REFERENCES repositories(repository_id) ON DELETE CASCADE
);

CREATE TABLE rankings (
	captured_date TEXT NOT NULL,
	category TEXT NOT NULL CHECK (category IN ('top_stars', 'top_forks', 'star_daily', 'star_weekly', 'star_monthly')),
	rank INTEGER NOT NULL CHECK (rank > 0),
	repository_id INTEGER NOT NULL,
	metric_value INTEGER NOT NULL,
	metric_delta INTEGER NOT NULL DEFAULT 0,
	baseline_date TEXT,
	PRIMARY KEY (captured_date, category, rank),
	UNIQUE (captured_date, category, repository_id),
	FOREIGN KEY (repository_id) REFERENCES repositories(repository_id) ON DELETE CASCADE
);

CREATE TABLE collection_runs (
	run_date TEXT PRIMARY KEY,
	status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
	lease_token TEXT,
	lease_expires_at TEXT,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	candidate_count INTEGER NOT NULL DEFAULT 0,
	snapshot_count INTEGER NOT NULL DEFAULT 0,
	error_summary TEXT
);

CREATE INDEX repository_snapshots_by_date
	ON repository_snapshots(captured_date, repository_id);
CREATE INDEX rankings_by_repository
	ON rankings(repository_id, captured_date);
CREATE INDEX repositories_by_language
	ON repositories(language, full_name);
`;

export type CollectionRunResult = {
	outcome: "acquired" | "recovered" | "already_completed";
	leaseToken: string | null;
};

type AcquireCollectionRunInput = {
	runDate: string;
	leaseToken: string;
	now: Date;
	leaseDurationMs: number;
};

type FinishCollectionRunInput = {
	runDate: string;
	leaseToken: string;
	finishedAt: Date;
};

type CompleteCollectionRunInput = FinishCollectionRunInput & {
	candidateCount: number;
	snapshotCount: number;
};

type FailCollectionRunInput = FinishCollectionRunInput & {
	errorSummary: string;
};

function toSqlitePathLiteral(path: string): string {
	return `'${path.replace(/'/g, "''")}'`;
}

function validateDatabasePath(path: string): void {
	if (path === ":memory:") return;
	if (/\p{Cc}/u.test(path)) {
		throw new Error("database path contains control characters");
	}
	if (!isAbsolute(path)) {
		throw new Error("database path must be absolute");
	}
}

function configureConnection(database: DatabaseSync): void {
	database.exec(`
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
PRAGMA journal_mode = WAL;
`);
}

function getSchemaVersion(database: DatabaseSync): number {
	return Number(
		(database.prepare("PRAGMA user_version").get() as { user_version: number })
			.user_version,
	);
}

function hasUserTables(database: DatabaseSync): boolean {
	return (
		Number(
			(
				database
					.prepare(
						"SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
					)
					.get() as { count: number }
			).count,
		) > 0
	);
}

function pruneBackups(databasePath: string): void {
	const directory = dirname(databasePath);
	const prefix = `${basename(databasePath)}.backup-`;
	const backups = readdirSync(directory)
		.filter((name) => name.startsWith(prefix))
		.sort()
		.reverse();
	for (const backup of backups.slice(MAX_BACKUPS)) {
		rmSync(join(directory, backup), { force: true });
	}
}

function backupBeforeMigration(
	database: DatabaseSync,
	databasePath: string,
	fromVersion: number,
): void {
	if (databasePath === ":memory:" || !existsSync(databasePath)) return;
	database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const backupPath = `${databasePath}.backup-v${fromVersion}-${timestamp}`;
	database.exec(`VACUUM INTO ${toSqlitePathLiteral(backupPath)}`);
	pruneBackups(databasePath);
}

function migrateDatabase(database: DatabaseSync, databasePath: string): void {
	const currentVersion = getSchemaVersion(database);
	if (currentVersion > SCHEMA_VERSION) {
		throw new Error(
			`trending schema version ${currentVersion} is newer than supported version ${SCHEMA_VERSION}`,
		);
	}
	if (currentVersion === SCHEMA_VERSION) return;
	if (currentVersion === 0 && hasUserTables(database)) {
		backupBeforeMigration(database, databasePath, currentVersion);
		throw new Error("database contains an unknown schema");
	}

	database.exec("BEGIN IMMEDIATE");
	try {
		database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
	version INTEGER PRIMARY KEY,
	applied_at TEXT NOT NULL
);
${MIGRATION_V1}
`);
		database
			.prepare(
				"INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
			)
			.run(SCHEMA_VERSION, new Date().toISOString());
		database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
		database.exec("COMMIT");
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

export function openTrendingDatabase(path: string): DatabaseSync {
	validateDatabasePath(path);
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const database = new DatabaseSync(path, {
		allowExtension: false,
		enableDoubleQuotedStringLiterals: false,
		enableForeignKeyConstraints: true,
	});
	try {
		configureConnection(database);
		migrateDatabase(database, path);
		return database;
	} catch (error) {
		database.close();
		throw error;
	}
}

export function acquireCollectionRun(
	database: DatabaseSync,
	input: AcquireCollectionRunInput,
): CollectionRunResult {
	if (input.leaseDurationMs <= 0) {
		throw new Error("lease duration must be positive");
	}
	const now = input.now.toISOString();
	const leaseExpiresAt = new Date(
		input.now.getTime() + input.leaseDurationMs,
	).toISOString();
	database.exec("BEGIN IMMEDIATE");
	try {
		const existing = database
			.prepare(
				"SELECT status, lease_expires_at FROM collection_runs WHERE run_date = ?",
			)
			.get(input.runDate) as
			| { status: string; lease_expires_at: string | null }
			| undefined;
		const isRecovery = existing?.status === "failed";
		if (existing?.status === "completed") {
			database.exec("COMMIT");
			return { outcome: "already_completed", leaseToken: null };
		}
		if (
			existing?.status === "running" &&
			existing.lease_expires_at &&
			existing.lease_expires_at > now
		) {
			throw new Error("collection is already running");
		}
		database
			.prepare(
				`INSERT INTO collection_runs (
	run_date, status, lease_token, lease_expires_at, started_at,
	finished_at, candidate_count, snapshot_count, error_summary
) VALUES (?, 'running', ?, ?, ?, NULL, 0, 0, NULL)
ON CONFLICT(run_date) DO UPDATE SET
	status = 'running',
	lease_token = excluded.lease_token,
	lease_expires_at = excluded.lease_expires_at,
	started_at = excluded.started_at,
	finished_at = NULL,
	candidate_count = 0,
	snapshot_count = 0,
	error_summary = CASE
		WHEN collection_runs.status = 'failed' THEN collection_runs.error_summary
		ELSE NULL
	END`,
			)
			.run(input.runDate, input.leaseToken, leaseExpiresAt, now);
		database.exec("COMMIT");
		return {
			outcome: isRecovery ? "recovered" : "acquired",
			leaseToken: input.leaseToken,
		};
	} catch (error) {
		database.exec("ROLLBACK");
		throw error;
	}
}

export function completeCollectionRun(
	database: DatabaseSync,
	input: CompleteCollectionRunInput,
): void {
	const result = database
		.prepare(
			`UPDATE collection_runs
SET status = 'completed', lease_token = NULL, lease_expires_at = NULL,
	finished_at = ?, candidate_count = ?, snapshot_count = ?, error_summary = NULL
WHERE run_date = ? AND status = 'running' AND lease_token = ?`,
		)
		.run(
			input.finishedAt.toISOString(),
			input.candidateCount,
			input.snapshotCount,
			input.runDate,
			input.leaseToken,
		);
	if (Number(result.changes) !== 1) {
		throw new Error("collection lease is no longer active");
	}
}

export function failCollectionRun(
	database: DatabaseSync,
	input: FailCollectionRunInput,
): void {
	const result = database
		.prepare(
			`UPDATE collection_runs
SET status = 'failed', lease_token = NULL, lease_expires_at = NULL,
	finished_at = ?, error_summary = ?
WHERE run_date = ? AND status = 'running' AND lease_token = ?`,
		)
		.run(
			input.finishedAt.toISOString(),
			input.errorSummary.slice(0, 500),
			input.runDate,
			input.leaseToken,
		);
	if (Number(result.changes) !== 1) {
		throw new Error("collection lease is no longer active");
	}
}
