import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POTETO_DIR = join(ROOT, "skills", "poteto-mode");
const RULES = readFileSync(join(POTETO_DIR, "SKILL.md"), "utf8");
const AGENT_PROMPT = readFileSync(join(ROOT, "agents", "poteto-agent.md"), "utf8");

function namedPrinciples(text) {
	return [...text.matchAll(/\*\*(principle-[a-z0-9-]+)\*\*/g)].map((match) => match[1]);
}

test("a session that reads the named principles finds every leaf skill", () => {
	const names = namedPrinciples(RULES);
	assert.ok(names.length > 0, "the ruleset names at least one principle");
	for (const name of names) {
		assert.ok(existsSync(join(ROOT, "skills", name, "SKILL.md")), `${name} has a leaf skill`);
	}
});

test("the ruleset states where a leaf principle skill lives", () => {
	const declared = RULES.match(/`(\.\.\/principle-[^`/]*\/SKILL\.md)`/);
	assert.ok(declared, "the Principles section names the leaf path relative to this file");
	const baseDir = dirname(dirname(resolve(POTETO_DIR, declared[1])));
	for (const name of namedPrinciples(RULES)) {
		assert.ok(existsSync(join(baseDir, name, "SKILL.md")), `${name} resolves from the stated path`);
	}
});

test("the poteto-agent prompt sends the reader to a directory that holds the principles", () => {
	const paths = [...AGENT_PROMPT.matchAll(/`(skills\/[a-z0-9\-/]*)`/g)].map((match) => match[1]);
	assert.ok(paths.length > 0, "the prompt names a path under skills/");
	for (const path of paths) {
		assert.ok(existsSync(join(ROOT, path)), `${path} exists`);
	}
	assert.ok(
		paths.some((path) => readdirSync(join(ROOT, path)).some((entry) => entry.startsWith("principle-"))),
		"one of the named directories holds the principle skills",
	);
});
