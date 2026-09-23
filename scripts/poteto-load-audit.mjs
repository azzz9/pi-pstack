#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const POTETO_SKILL_PATH = "/skills/poteto-mode/SKILL.md";
const POTETO_RULES_TYPE = "pstack-poteto-rules";
const OTHER_SKILL_PATH = /\/skills\/([^/]+)\/SKILL\.md$/;

function messageText(message) {
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

function firstParsable(lines) {
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			return JSON.parse(line);
		} catch {
			continue;
		}
	}
	return undefined;
}

export function parseSession(text) {
	const lines = text.split("\n");
	const header = firstParsable(lines);
	if (!header || header.type !== "session") return null;
	let mode = "default";
	const otherSkills = new Set();
	let skillBlock = false;
	let readCalls = 0;
	let bashMentions = 0;
	let rulesMessages = 0;
	let userMessages = 0;
	let assistantTurns = 0;
	for (const line of lines) {
		if (!line.trim()) continue;
		let entry;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}
		if (entry.type === "custom" && entry.customType === "pstack-mode") {
			mode = entry.data?.enabled === true ? "on" : "off";
		}
		if (entry.type === "custom_message" && entry.customType === POTETO_RULES_TYPE) {
			rulesMessages += 1;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (!message || typeof message !== "object") continue;
		if (message.role === "user") {
			const text = messageText(message);
			if (!text.startsWith("/")) userMessages += 1;
			if (text.startsWith('<skill name="poteto-mode"')) skillBlock = true;
		}
		if (message.role === "assistant") assistantTurns += 1;
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (block?.type !== "toolCall") continue;
			if (block.name === "read") {
				const path = block.arguments?.path;
				if (typeof path !== "string") continue;
				if (path.endsWith(POTETO_SKILL_PATH)) readCalls += 1;
				const other = OTHER_SKILL_PATH.exec(path);
				if (other && other[1] !== "poteto-mode") otherSkills.add(other[1]);
			}
			if (block.name === "bash") {
				const command = block.arguments?.command;
				if (typeof command === "string" && command.includes("poteto-mode/SKILL.md")) bashMentions += 1;
			}
		}
	}
	return {
		cwd: header.cwd,
		timestamp: header.timestamp,
		mode,
		skillBlock,
		readCalls,
		bashMentions,
		rulesMessages,
		loaded: skillBlock || readCalls > 0 || rulesMessages > 0,
		otherSkills: [...otherSkills].sort(),
		userMessages,
		assistantTurns,
		substantive: userMessages >= 1 && assistantTurns >= 3,
	};
}

function rate(numerator, denominator) {
	return denominator === 0 ? null : numerator / denominator;
}

export function summarize(sessions) {
	const modes = { default: 0, on: 0, off: 0 };
	for (const session of sessions) modes[session.mode] += 1;
	const modeOn = sessions.filter((session) => session.mode === "default" || session.mode === "on");
	const substantive = modeOn.filter((session) => session.substantive);
	const loaded = modeOn.filter((session) => session.loaded);
	const loadedSubstantive = substantive.filter((session) => session.loaded);
	const skillCounts = new Map();
	for (const session of sessions) {
		for (const skill of session.otherSkills) {
			skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
		}
	}
	const otherSkills = [...skillCounts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 10)
		.map(([skill, count]) => ({ skill, sessions: count }));
	return {
		sessions: sessions.length,
		modes,
		modeOn: {
			total: modeOn.length,
			loaded: loaded.length,
			loadedRate: rate(loaded.length, modeOn.length),
			substantive: substantive.length,
			loadedSubstantive: loadedSubstantive.length,
			loadedSubstantiveRate: rate(loadedSubstantive.length, substantive.length),
		},
		bashMentions: sessions.reduce((sum, session) => sum + session.bashMentions, 0),
		otherSkills,
	};
}

function discoverFiles(sessionsDir) {
	let dirs;
	try {
		dirs = readdirSync(sessionsDir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files = [];
	for (const dir of dirs) {
		if (!dir.isDirectory()) continue;
		const dirPath = join(sessionsDir, dir.name);
		let entries;
		try {
			entries = readdirSync(dirPath, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
			const file = join(dirPath, entry.name);
			if (file.includes("subagent-artifacts/")) continue;
			files.push(file);
		}
	}
	return files.sort();
}

function applyFilters(sessions, since, limit) {
	let kept = sessions;
	if (since !== undefined) {
		const sinceMs = Date.parse(since);
		kept = kept.filter((session) => Date.parse(session.timestamp) >= sinceMs);
	}
	kept = [...kept].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
	if (limit !== undefined) kept = kept.slice(Math.max(kept.length - limit, 0));
	return kept;
}

function percent(value) {
	return value === null ? " (n/a)" : ` (${(value * 100).toFixed(1)}%)`;
}

function printTable(sessions, summary) {
	if (sessions.length > 0) {
		console.log("timestamp\tmode\tloaded\treads\tskill\tuser\tassistant\tcwd");
		for (const session of sessions) {
			console.log(
				[
					session.timestamp,
					session.mode,
					session.loaded ? "yes" : "no",
					session.readCalls,
					session.skillBlock ? "yes" : "no",
					session.userMessages,
					session.assistantTurns,
					session.cwd ? basename(session.cwd) : "",
				].join("\t"),
			);
		}
	} else {
		console.log("no sessions matched");
	}
	console.log("");
	console.log(
		`sessions: ${summary.sessions} (default ${summary.modes.default}, on ${summary.modes.on}, off ${summary.modes.off})`,
	);
	console.log(
		`mode-on (default + on): ${summary.modeOn.total} sessions, loaded ${summary.modeOn.loaded}${percent(summary.modeOn.loadedRate)}, substantive ${summary.modeOn.substantive}, loaded ${summary.modeOn.loadedSubstantive}${percent(summary.modeOn.loadedSubstantiveRate)}`,
	);
	console.log(`bash mentions of poteto-mode/SKILL.md: ${summary.bashMentions}`);
	const otherSkills = summary.otherSkills.map((entry) => `${entry.skill} (${entry.sessions})`).join(", ");
	console.log(`top other skills read: ${otherSkills || "none"}`);
}

export function main(argv = process.argv.slice(2)) {
	const options = { sessionsDir: join(homedir(), ".pi", "agent", "sessions"), since: undefined, limit: undefined, json: false };
	for (let i = 0; i < argv.length; i += 1) {
		if (argv[i] === "--json") options.json = true;
		else if (argv[i] === "--sessions-dir") options.sessionsDir = argv[(i += 1)];
		else if (argv[i] === "--since") options.since = argv[(i += 1)];
		else if (argv[i] === "--limit") options.limit = Number(argv[(i += 1)]);
	}
	if (!Number.isFinite(options.limit)) options.limit = undefined;
	const sessions = [];
	for (const file of discoverFiles(options.sessionsDir)) {
		let text;
		try {
			text = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const session = parseSession(text);
		if (session) sessions.push({ ...session, file });
	}
	const kept = applyFilters(sessions, options.since, options.limit);
	const summary = summarize(kept);
	if (options.json) {
		process.stdout.write(`${JSON.stringify({ sessions: kept, summary }, null, "\t")}\n`);
	} else {
		printTable(kept, summary);
	}
	return { sessions: kept, summary };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) main();