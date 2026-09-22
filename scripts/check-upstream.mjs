#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PI_HARNESS_FIXES, classify } from "./reground-from-cursor.mjs";

// Tracks the Cursor pstack plugin this fork is regenerated from. See FORK.md.
export const UPSTREAM = {
	repo: "cursor/plugins",
	ref: "main",
	path: "pstack",
	versionFile: ".cursor-plugin/plugin.json",
};

// 0 clean, 1 upstream moved, 2 the check could not run, 3 the upstream path is
// gone, 4 no sync point recorded yet. Automation branches on these, so drift
// and failure must not share a code.
export const EXIT = {
	clean: 0,
	drift: 1,
	checkFailed: 2,
	upstreamMissing: 3,
	unbaselined: 4,
};

export const LOCK_PATH = fileURLToPath(new URL("../upstream.lock.json", import.meta.url));

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const COMPARE_FILE_CAP = 300;

export class CheckFailure extends Error {
	constructor(message, kind = "network") {
		super(message);
		this.name = "CheckFailure";
		this.kind = kind;
	}
}

function apiHeaders() {
	const headers = {
		accept: "application/vnd.github+json",
		"user-agent": "pi-pstack-check-upstream",
	};
	const token = process.env.GITHUB_TOKEN;
	if (token) headers.authorization = `Bearer ${token}`;
	return headers;
}

async function getJson(fetchImpl, url) {
	let response;
	try {
		response = await fetchImpl(url, { headers: apiHeaders() });
	} catch (err) {
		throw new CheckFailure(`cannot reach ${url}: ${err.message}`, "network");
	}
	if (!response.ok) {
		throw new CheckFailure(`${url} returned HTTP ${response.status}`, "http");
	}
	try {
		return await response.json();
	} catch {
		throw new CheckFailure(`${url} did not return JSON`, "parse");
	}
}

// The newest commit that touched upstream's pstack directory, optionally scoped
// to the ancestors of a recorded sync point. A repo-wide ref would report other
// plugins' commits as pstack drift.
async function newestPstackCommit(fetchImpl, sourceCommit) {
	const params = new URLSearchParams({ path: UPSTREAM.path, per_page: "1" });
	if (sourceCommit) params.set("sha", sourceCommit);
	const commits = await getJson(fetchImpl, `${API}/repos/${UPSTREAM.repo}/commits?${params}`);
	if (!Array.isArray(commits)) {
		throw new CheckFailure("the commits response was not a list", "parse");
	}
	if (commits.length === 0) return null;
	return { commit: commits[0].sha, date: commits[0].commit?.committer?.date ?? null };
}

async function versionAt(fetchImpl, commit) {
	if (!commit) return null;
	const url = `${RAW}/${UPSTREAM.repo}/${commit}/${UPSTREAM.path}/${UPSTREAM.versionFile}`;
	const doc = await getJson(fetchImpl, url);
	return typeof doc.version === "string" ? doc.version : null;
}

async function comparePaths(fetchImpl, base, head) {
	const url = `${API}/repos/${UPSTREAM.repo}/compare/${base}...${head}`;
	const strip = (name) =>
		typeof name === "string" && name.startsWith(`${UPSTREAM.path}/`)
			? name.slice(UPSTREAM.path.length + 1)
			: null;
	let response;
	try {
		response = await fetchImpl(url, { headers: apiHeaders() });
	} catch (err) {
		return { files: null, note: `the changed path list is unavailable: ${err.message}` };
	}
	if (!response.ok) {
		return { files: null, note: `the changed path list is unavailable: HTTP ${response.status}` };
	}
	const doc = await response.json();
	const all = Array.isArray(doc.files) ? doc.files : [];
	// A compare range spans the whole monorepo, so only pstack paths count.
	const files = all
		.filter((file) => strip(file.filename))
		.map((file) => ({
			path: strip(file.filename),
			status: file.status ?? "modified",
			previousPath: strip(file.previous_filename),
		}));
	const note =
		all.length >= COMPARE_FILE_CAP
			? `upstream reported at least ${COMPARE_FILE_CAP} changed files, so only the first ${COMPARE_FILE_CAP} are listed`
			: null;
	return { files, note };
}

const KIND_ORDER = ["unclassified", "adapt", "copy", "pi-only", "never-copy"];

// Splits changed upstream paths by how much local work each one costs, and
// names the ones the harness fix table already rewrites.
export function summarizeChanges(files) {
	const ruleCount = new Map();
	for (const rule of PI_HARNESS_FIXES.rules) {
		ruleCount.set(rule.file, (ruleCount.get(rule.file) ?? 0) + 1);
	}
	const renamedTo = new Map(PI_HARNESS_FIXES.renames.map((rename) => [rename.from, rename.to]));
	const entries = files.map((file) => {
		const canonical = renamedTo.get(file.path) ?? file.path;
		let kind;
		try {
			kind = classify(canonical);
		} catch {
			kind = "unclassified";
		}
		return { ...file, canonical, kind, harnessRules: ruleCount.get(canonical) ?? 0 };
	});
	entries.sort((a, b) => {
		const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
		return byKind !== 0 ? byKind : a.path.localeCompare(b.path);
	});
	const byKind = {};
	for (const kind of KIND_ORDER) byKind[kind] = 0;
	for (const entry of entries) byKind[entry.kind] += 1;
	return {
		entries,
		byKind,
		actionable: entries.filter((entry) => entry.kind !== "never-copy" && entry.kind !== "pi-only").length,
		unclassified: entries.filter((entry) => entry.kind === "unclassified").length,
		harnessTouched: entries.filter((entry) => entry.harnessRules > 0).length,
	};
}

function versionDelta(recorded, upstream) {
	if (!recorded || !upstream || recorded === upstream) return null;
	return { recorded, upstream };
}

export function loadLock(path = LOCK_PATH) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (err) {
		throw new CheckFailure(`cannot read ${path}: ${err.message}`, "lock");
	}
	let doc;
	try {
		doc = JSON.parse(text);
	} catch (err) {
		throw new CheckFailure(`${path} is not valid JSON: ${err.message}`, "lock");
	}
	if (!doc || typeof doc !== "object" || doc.schema !== 1) {
		throw new CheckFailure(`${path} is not a schema 1 lock file`, "lock");
	}
	if (!doc.upstream || typeof doc.upstream !== "object") {
		throw new CheckFailure(`${path} has no upstream object`, "lock");
	}
	return doc;
}

export async function checkUpstream({ lock, fetchImpl = fetch, compare = true } = {}) {
	const recorded = lock?.upstream ?? {};
	const syncVersion = typeof recorded.version === "string" ? recorded.version : null;
	try {
		const tip = await newestPstackCommit(fetchImpl);
		if (tip === null) {
			return {
				state: "upstream-missing",
				error: `${UPSTREAM.repo} has no commits under ${UPSTREAM.path}/`,
			};
		}
		const version = await versionAt(fetchImpl, tip.commit);
		const upstream = {
			repo: UPSTREAM.repo,
			ref: UPSTREAM.ref,
			path: UPSTREAM.path,
			commit: tip.commit,
			date: tip.date,
			version,
		};
		const base = { upstream, syncPoint: recorded.sourceCommit ?? null, versionDelta: versionDelta(syncVersion, version) };
		if (!recorded.sourceCommit) {
			return { state: "unbaselined", ...base };
		}
		const synced = await newestPstackCommit(fetchImpl, recorded.sourceCommit);
		if (synced === null) {
			throw new CheckFailure(
				`no ${UPSTREAM.path}/ commit reaches the recorded sync point ${recorded.sourceCommit}`,
				"parse",
			);
		}
		if (synced.commit === tip.commit) {
			return { state: "clean", ...base, syncedCommit: synced.commit };
		}
		const changed = compare ? await comparePaths(fetchImpl, synced.commit, tip.commit) : { files: null, note: null };
		return {
			state: "drift",
			...base,
			syncedCommit: synced.commit,
			syncedDate: synced.date,
			changes: changed.files ? summarizeChanges(changed.files) : null,
			changesNote: changed.note,
		};
	} catch (err) {
		if (err instanceof CheckFailure) {
			return { state: "check-failed", error: err.message, kind: err.kind };
		}
		throw err;
	}
}

const STATE_LABELS = {
	clean: "in sync",
	drift: "upstream moved",
	unbaselined: "no sync point recorded",
	"upstream-missing": "upstream path gone",
	"check-failed": "check failed",
};

export function exitCodeFor(state) {
	if (state === "clean") return EXIT.clean;
	if (state === "drift") return EXIT.drift;
	if (state === "upstream-missing") return EXIT.upstreamMissing;
	if (state === "unbaselined") return EXIT.unbaselined;
	return EXIT.checkFailed;
}

function short(commit) {
	return typeof commit === "string" ? commit.slice(0, 8) : "unknown";
}

export function renderReport(result) {
	const lines = ["pi-pstack upstream check"];
	if (result.upstream) {
		const { commit, date, version } = result.upstream;
		lines.push(
			`  upstream   ${UPSTREAM.repo} ${UPSTREAM.path}/ at ${short(commit)} ${date ? date.slice(0, 10) : "unknown date"}` +
				`${version ? `, version ${version}` : ""}`,
		);
	} else {
		lines.push(`  upstream   ${UPSTREAM.repo} ${UPSTREAM.path}/`);
	}
	if (result.syncPoint) {
		lines.push(`  sync point recorded from ${short(result.syncPoint)}`);
	} else {
		lines.push("  sync point none recorded");
	}
	if (result.versionDelta) {
		lines.push(`  version    recorded ${result.versionDelta.recorded} -> upstream ${result.versionDelta.upstream}`);
	}
	lines.push("", `state: ${result.state} (${STATE_LABELS[result.state] ?? "unknown"})`);

	if (result.state === "drift") {
		const changes = result.changes;
		if (result.syncedDate) {
			lines.push(`  upstream moved from ${short(result.syncedCommit)} ${result.syncedDate.slice(0, 10)}`);
		} else {
			lines.push(`  upstream moved from ${short(result.syncedCommit)}`);
		}
		if (!changes) {
			lines.push(`  changed paths not listed: ${result.changesNote ?? "compare was skipped"}`);
		} else {
			const { byKind, entries, actionable, harnessTouched } = changes;
			const counts = KIND_ORDER.filter((kind) => byKind[kind] > 0)
				.map((kind) => `${kind} ${byKind[kind]}`)
				.join(", ");
			lines.push(`  ${entries.length} changed path(s) under ${UPSTREAM.path}/: ${counts}`);
			for (const entry of entries) {
				const bits = [entry.kind, `${entry.status} ${entry.path}`];
				if (entry.previousPath) bits.push(`from ${entry.previousPath}`);
				if (entry.harnessRules > 0) bits.push(`${entry.harnessRules} harness fix(es)`);
				lines.push(`    ${bits.join("  ")}`);
			}
			lines.push(`  ${actionable} path(s) a reground would rewrite; ${harnessTouched} named by the harness fix table`);
			if (result.changesNote) lines.push(`  note: ${result.changesNote}`);
		}
		lines.push("", "Run scripts/reground-from-cursor.mjs from a Cursor checkout to take the update. See FORK.md.");
	}
	if (result.state === "unbaselined") {
		lines.push(
			`  the tree carries local harness fixes on ${result.versionDelta?.recorded ?? "an unrecorded"} upstream content,`,
			"  and no Cursor commit was ever recorded for it.",
			"",
			"Run scripts/reground-from-cursor.mjs from a Cursor checkout to record a sync point. See FORK.md.",
		);
	}
	if (result.state === "upstream-missing") {
		lines.push(`  ${result.error}`, "", `Check whether ${UPSTREAM.path}/ moved or was renamed upstream.`);
	}
	if (result.state === "check-failed") {
		lines.push(`  ${result.error}`, "", "Nothing was compared. This is not a clean result.");
	}
	return lines.join("\n");
}

export function parseArgs(argv) {
	let json = false;
	let compare = true;
	let lock = LOCK_PATH;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") json = true;
		else if (arg === "--no-compare") compare = false;
		else if (arg === "--lock") lock = argv[++i];
		else throw new Error(`unknown arg: ${arg}`);
	}
	if (!lock) throw new Error("usage: check-upstream.mjs [--json] [--no-compare] [--lock <path>]");
	return { json, compare, lock };
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch, out = console.log } = {}) {
	const args = parseArgs(argv);
	let lock;
	try {
		lock = loadLock(args.lock);
	} catch (err) {
		const result = {
			state: "check-failed",
			error: err instanceof Error ? err.message : String(err),
			kind: "lock",
		};
		out(args.json ? JSON.stringify(result, null, 2) : renderReport(result));
		return EXIT.checkFailed;
	}
	const result = await checkUpstream({ lock, fetchImpl, compare: args.compare });
	out(args.json ? JSON.stringify(result, null, 2) : renderReport(result));
	return exitCodeFor(result.state);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((err) => {
			console.error(err instanceof Error ? err.message : err);
			process.exitCode = EXIT.checkFailed;
		});
}
