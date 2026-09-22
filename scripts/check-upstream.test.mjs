import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	EXIT,
	checkUpstream,
	exitCodeFor,
	loadLock,
	renderReport,
	summarizeChanges,
} from "./check-upstream.mjs";
import { writeUpstreamLock } from "./reground-from-cursor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const TIP = "b".repeat(40);
const SYNCED = "a".repeat(40);
const DATE = "2026-09-13T03:38:59Z";

function jsonResponse(body, status = 200) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// A GitHub fixture keyed on the two commit queries the checker makes: unscoped
// for the upstream tip, sha-scoped for the recorded sync point.
function upstreamFetch({ upstream = { commit: TIP, date: DATE }, synced = { commit: SYNCED, date: DATE }, version = "0.15.2", compare = null, versionStatus = 200 } = {}) {
	const calls = [];
	const fetchImpl = async (url) => {
		calls.push(url);
		if (url.includes("/repos/cursor/plugins/commits?")) {
			const entry = url.includes("sha=") ? synced : upstream;
			if (entry === "http-403") return jsonResponse({}, 403);
			if (entry === null) return jsonResponse([]);
			return jsonResponse([{ sha: entry.commit, commit: { committer: { date: entry.date } } }]);
		}
		if (url.includes("raw.githubusercontent.com")) {
			if (versionStatus !== 200) return jsonResponse({}, versionStatus);
			return jsonResponse({ version });
		}
		if (url.includes("/compare/")) {
			if (compare === "http-404") return jsonResponse({}, 404);
			return jsonResponse(compare);
		}
		throw new Error(`unexpected fetch: ${url}`);
	};
	return { fetchImpl, calls };
}

function lockWith(sourceCommit, version = "0.15.0") {
	return { schema: 1, upstream: { repo: "cursor/plugins", ref: "main", path: "pstack", sourceCommit, version } };
}

test("an unbaselined lock reports upstream position instead of a clean result", async () => {
	const { fetchImpl, calls } = upstreamFetch();
	const result = await checkUpstream({ lock: lockWith(null), fetchImpl });
	assert.equal(result.state, "unbaselined");
	assert.equal(exitCodeFor(result.state), EXIT.unbaselined);
	assert.equal(result.upstream.commit, TIP);
	assert.equal(result.upstream.version, "0.15.2");
	assert.equal(result.versionDelta.recorded, "0.15.0");
	assert.equal(calls.some((url) => url.includes("sha=")), false);
	const report = renderReport(result);
	assert.match(report, /no sync point recorded/);
	assert.match(report, /reground-from-cursor\.mjs/);
});

test("a sync point at the upstream pstack tip is clean", async () => {
	const { fetchImpl, calls } = upstreamFetch({
		upstream: { commit: TIP, date: DATE },
		synced: { commit: TIP, date: DATE },
		version: "0.15.0",
	});
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "clean");
	assert.equal(exitCodeFor(result.state), EXIT.clean);
	assert.equal(result.versionDelta, null);
	assert.equal(result.syncedCommit, TIP);
	assert.equal(calls.some((url) => url.includes("/compare/")), false);
	assert.match(renderReport(result), /state: clean \(in sync\)/);
});

test("drift splits changed pstack paths by local cost and ignores the rest of the monorepo", async () => {
	const { fetchImpl } = upstreamFetch({
		compare: {
			total_commits: 3,
			files: [
				{ filename: "pstack/skills/how/SKILL.md", status: "modified" },
				{ filename: "pstack/skills/principle-attack-the-premise/SKILL.md", status: "modified" },
				{ filename: "pstack/playbooks/new-playbook.md", status: "added" },
				{ filename: "pstack/assets/logo.png", status: "modified" },
				{ filename: "third_party/x/README.md", status: "modified" },
				{
					filename: "pstack/skills/poteto-mode/references/review-triage.md",
					status: "renamed",
					previous_filename: "pstack/skills/poteto-mode/references/bugbot-triage.md",
				},
			],
		},
	});
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "drift");
	assert.equal(exitCodeFor(result.state), EXIT.drift);
	const changes = result.changes;
	assert.equal(changes.entries.length, 5);
	assert.deepEqual(changes.byKind, { unclassified: 1, adapt: 2, copy: 1, "pi-only": 0, "never-copy": 1 });
	assert.equal(changes.actionable, 4);
	assert.equal(changes.unclassified, 1);
	assert.equal(changes.harnessTouched, 1);
	assert.equal(changes.entries[0].path, "playbooks/new-playbook.md");
	assert.equal(changes.entries[0].kind, "unclassified");
	const renamed = changes.entries.find((entry) => entry.previousPath);
	assert.equal(renamed.canonical, "skills/poteto-mode/references/review-triage.md");
	assert.equal(renamed.harnessRules, 11);
	const report = renderReport(result);
	assert.match(report, /upstream moved from aaaaaaaa/);
	assert.match(report, /4 path\(s\) a reground would rewrite; 1 named by the harness fix table/);
});

test("drift without a usable compare response still reports the move", async () => {
	const { fetchImpl } = upstreamFetch({ compare: "http-404" });
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "drift");
	assert.equal(result.changes, null);
	assert.match(result.changesNote, /HTTP 404/);
	assert.match(renderReport(result), /changed paths not listed/);
});

test("a capped compare response says the path list is incomplete", async () => {
	const files = Array.from({ length: 300 }, (_, index) => ({
		filename: `pstack/skills/principle-x-${index}/SKILL.md`,
		status: "modified",
	}));
	const { fetchImpl } = upstreamFetch({ compare: { files } });
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "drift");
	assert.equal(result.changes.entries.length, 300);
	assert.match(result.changesNote, /at least 300 changed files/);
});

test("an empty pstack history is upstream missing, not drift", async () => {
	const { fetchImpl } = upstreamFetch({ upstream: null });
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "upstream-missing");
	assert.equal(exitCodeFor(result.state), EXIT.upstreamMissing);
	assert.match(renderReport(result), /no commits under pstack\//);
});

test("a rate-limited probe is a failed check, never drift", async () => {
	const { fetchImpl } = upstreamFetch({ upstream: "http-403" });
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "check-failed");
	assert.equal(result.kind, "http");
	assert.equal(exitCodeFor(result.state), EXIT.checkFailed);
	assert.match(renderReport(result), /This is not a clean result/);
});

test("a sync point that no pstack commit reaches fails the check", async () => {
	const { fetchImpl } = upstreamFetch({ synced: null });
	const result = await checkUpstream({ lock: lockWith(SYNCED), fetchImpl });
	assert.equal(result.state, "check-failed");
	assert.match(result.error, /no pstack\/ commit reaches the recorded sync point/);
});

test("a recorded version behind upstream surfaces even when the commits match", async () => {
	const { fetchImpl } = upstreamFetch({
		upstream: { commit: TIP, date: DATE },
		synced: { commit: TIP, date: DATE },
		version: "0.15.2",
	});
	const result = await checkUpstream({ lock: lockWith(SYNCED, "0.15.0"), fetchImpl });
	assert.equal(result.state, "clean");
	assert.deepEqual(result.versionDelta, { recorded: "0.15.0", upstream: "0.15.2" });
	assert.match(renderReport(result), /recorded 0\.15\.0 -> upstream 0\.15\.2/);
});

test("summarizeChanges keeps unclassified paths at the top", () => {
	const summary = summarizeChanges([
		{ path: "skills/how/SKILL.md", status: "modified", previousPath: null },
		{ path: "new-root/thing.md", status: "added", previousPath: null },
	]);
	assert.deepEqual(
		summary.entries.map((entry) => entry.kind),
		["unclassified", "adapt"],
	);
});

test("loadLock rejects a file that is not a schema 1 lock", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-lock-"));
	const broken = join(dir, "upstream.lock.json");
	writeFileSync(broken, JSON.stringify({ schema: 2, upstream: {} }));
	assert.throws(() => loadLock(broken), /not a schema 1 lock file/);
	writeFileSync(broken, "{");
	assert.throws(() => loadLock(broken), /not valid JSON/);
	writeFileSync(broken, JSON.stringify({ schema: 1 }));
	assert.throws(() => loadLock(broken), /no upstream object/);
	assert.throws(() => loadLock(join(dir, "absent.json")), /cannot read/);
});

test("the lock write is idempotent and records the checkout, not a clock", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-lock-write-"));
	mkdirSync(dir, { recursive: true });
	const identity = { commit: SYNCED, version: "0.15.2" };
	assert.equal(writeUpstreamLock(dir, identity), true);
	assert.equal(writeUpstreamLock(dir, identity), false);
	const text = readFileSync(join(dir, "upstream.lock.json"), "utf8");
	const lock = JSON.parse(text);
	assert.equal(lock.schema, 1);
	assert.equal(lock.upstream.sourceCommit, SYNCED);
	assert.equal(lock.upstream.version, "0.15.2");
	assert.equal(lock.upstream.repo, "cursor/plugins");
	assert.equal(lock.upstream.ref, "main");
	assert.equal(lock.upstream.path, "pstack");
	assert.equal(Object.hasOwn(lock.upstream, "syncedAt"), false);
	assert.match(text, /\n {0}\t/);
});

test("the committed lock version matches the newest CHANGELOG sync line", () => {
	const lock = loadLock(join(ROOT, "upstream.lock.json"));
	const changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
	const match = /Sync Cursor pstack (\d+\.\d+\.\d+)/.exec(changelog);
	assert.ok(match, "CHANGELOG.md should record the Cursor pstack version it synced");
	assert.equal(
		lock.upstream.version,
		match[1],
		"upstream.lock.json must record the version the fork's content actually came from",
	);
});
