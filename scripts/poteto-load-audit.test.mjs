import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main, parseSession, summarize } from "./poteto-load-audit.mjs";

const SKILL_PATH = "/home/azzz/.pi/agent/skills/poteto-mode/SKILL.md";

function sessionLine(cwd, timestamp) {
	return JSON.stringify({ type: "session", version: 3, id: "01890a5d-ac96-774b-bcce-b302099a8057", timestamp, cwd });
}

function userLine(content, timestamp) {
	return JSON.stringify({ type: "message", id: "u1", parentId: null, timestamp, message: { role: "user", content } });
}

function assistantLine(content, timestamp) {
	return JSON.stringify({ type: "message", id: "a1", parentId: null, timestamp, message: { role: "assistant", content } });
}

function customLine(enabled, timestamp) {
	return JSON.stringify({ type: "custom", customType: "pstack-mode", data: { enabled }, id: "c1", parentId: null, timestamp });
}

function substantiveSession(lines) {
	return [
		sessionLine("/repo", "2026-02-01T00:00:00.000Z"),
		...lines,
		assistantLine("working", "2026-02-01T00:00:02.000Z"),
		assistantLine("done", "2026-02-01T00:00:03.000Z"),
	].join("\n");
}

function writeSession(dir, name, text) {
	mkdirSync(join(dir, "proj"), { recursive: true });
	writeFileSync(join(dir, "proj", name), `${text}\n`);
}

test("default-on session without a load is not loaded", () => {
	const text = substantiveSession([userLine("hello", "2026-02-01T00:00:01.000Z")]);
	const session = parseSession(text);
	assert.equal(session.mode, "default", "no pstack-mode entry stays default");
	assert.equal(session.loaded, false, "no skill block and no read keeps loaded false");
});

test("a poteto-mode skill block in a user message counts as loaded", () => {
	const block = `<skill name="poteto-mode" location="${SKILL_PATH}">\n# Poteto mode\n`;
	const text = [
		sessionLine("/repo", "2026-02-01T00:00:00.000Z"),
		userLine(block, "2026-02-01T00:00:01.000Z"),
		assistantLine("on it", "2026-02-01T00:00:02.000Z"),
		assistantLine("done", "2026-02-01T00:00:03.000Z"),
	].join("\n");
	const session = parseSession(text);
	assert.equal(session.skillBlock, true, "the skill expansion appears in user text");
	assert.equal(session.loaded, true, "a skill block loads the skill body");
});

test("an injected rules message counts as loaded", () => {
	const text = [
		sessionLine("/repo", "2026-02-01T00:00:00.000Z"),
		JSON.stringify({ type: "custom_message", customType: "pstack-poteto-rules", content: "POTETO MODE IS ON", display: false }),
		userLine("hello", "2026-02-01T00:00:01.000Z"),
	].join("\n");
	const session = parseSession(text);
	assert.equal(session.rulesMessages, 1, "one injected rules message");
	assert.equal(session.loaded, true, "the injected body is in context");
});

test("a read tool call on the poteto-mode skill path counts as loaded", () => {
	const text = [
		sessionLine("/repo", "2026-02-01T00:00:00.000Z"),
		assistantLine([{ type: "toolCall", id: "call_1", name: "read", arguments: { path: SKILL_PATH } }], "2026-02-01T00:00:01.000Z"),
	].join("\n");
	const session = parseSession(text);
	assert.equal(session.readCalls, 1, "one read call on the skill path");
	assert.equal(session.loaded, true, "a read of the skill file loads the skill");
});

test("a bash wc -l on the skill file is a mention but not a load", () => {
	const text = [
		sessionLine("/repo", "2026-02-01T00:00:00.000Z"),
		assistantLine([{ type: "toolCall", id: "call_2", name: "bash", arguments: { command: `wc -l ${SKILL_PATH}` } }], "2026-02-01T00:00:01.000Z"),
	].join("\n");
	const session = parseSession(text);
	assert.equal(session.bashMentions, 1, "the bash command mentions the skill file");
	assert.equal(session.loaded, false, "a bash mention does not count as loaded");
});

test("a session with pstack-mode off is off and outside the loaded-rate denominator", () => {
	const text = substantiveSession([
		customLine(false, "2026-02-01T00:00:01.000Z"),
		userLine("hello", "2026-02-01T00:00:02.000Z"),
	]);
	const session = parseSession(text);
	assert.equal(session.mode, "off", "the off toggle wins over the default");
	assert.equal(session.loaded, false, "off sessions stay unloaded in this fixture");
	assert.equal(summarize([session]).modeOn.total, 0, "an off session is excluded from the mode-on denominator");
});

test("summarize aggregates modes, loaded rates, and bash mentions over the fixtures", () => {
	const defaultUnloaded = substantiveSession([
		assistantLine([{ type: "toolCall", id: "call_3", name: "read", arguments: { path: "/home/azzz/.pi/agent/skills/how/SKILL.md" } }], "2026-02-01T00:00:01.000Z"),
		userLine("hello", "2026-02-01T00:00:02.000Z"),
	]);
	const skillBlock = [
		sessionLine("/repo-b", "2026-02-02T00:00:00.000Z"),
		userLine(`<skill name="poteto-mode" location="${SKILL_PATH}">\n# Poteto mode\n`, "2026-02-02T00:00:01.000Z"),
		assistantLine("on it", "2026-02-02T00:00:02.000Z"),
		assistantLine("still working", "2026-02-02T00:00:03.000Z"),
		assistantLine("done", "2026-02-02T00:00:04.000Z"),
	].join("\n");
	const readLoaded = [
		sessionLine("/repo-c", "2026-02-03T00:00:00.000Z"),
		assistantLine([{ type: "toolCall", id: "call_4", name: "read", arguments: { path: SKILL_PATH } }], "2026-02-03T00:00:01.000Z"),
	].join("\n");
	const bashMention = [
		sessionLine("/repo-d", "2026-02-04T00:00:00.000Z"),
		assistantLine([{ type: "toolCall", id: "call_5", name: "bash", arguments: { command: `wc -l ${SKILL_PATH}` } }], "2026-02-04T00:00:01.000Z"),
	].join("\n");
	const off = substantiveSession([
		customLine(false, "2026-02-05T00:00:01.000Z"),
		userLine("hello", "2026-02-05T00:00:02.000Z"),
	]);
	const summary = summarize([defaultUnloaded, skillBlock, readLoaded, bashMention, off].map(parseSession));
	assert.equal(summary.sessions, 5, "all five sessions are summarized");
	assert.deepEqual(summary.modes, { default: 4, on: 0, off: 1 });
	assert.deepEqual(summary.modeOn, {
		total: 4,
		loaded: 2,
		loadedRate: 0.5,
		substantive: 2,
		loadedSubstantive: 1,
		loadedSubstantiveRate: 0.5,
	}, "rates cover only mode-on sessions");
	assert.equal(summary.bashMentions, 1, "the bash mention is its own count");
	assert.deepEqual(summary.otherSkills, [{ skill: "how", sessions: 1 }]);
});

test("--since keeps only sessions at or after the instant", () => {
	const dir = mkdtempSync(join(tmpdir(), "poteto-audit-"));
	writeSession(
		dir,
		"old.jsonl",
		[sessionLine("/repo-old", "2026-02-01T00:00:00.000Z"), userLine("hello", "2026-02-01T00:00:01.000Z"), assistantLine("hi", "2026-02-01T00:00:02.000Z")].join("\n"),
	);
	writeSession(
		dir,
		"new.jsonl",
		[sessionLine("/repo-new", "2026-02-03T00:00:00.000Z"), userLine("hello", "2026-02-03T00:00:01.000Z"), assistantLine("hi", "2026-02-03T00:00:02.000Z")].join("\n"),
	);
	const result = main(["--sessions-dir", dir, "--since", "2026-02-02T00:00:00Z", "--json"]);
	assert.equal(result.sessions.length, 1, "the older session is dropped");
	assert.equal(result.sessions[0].cwd, "/repo-new", "the kept session is the newer one");
});