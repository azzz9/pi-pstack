import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, parseConfig } from "./config.ts";
import { type ModeEntry, sessionPotetoMode, systemPromptInjection } from "./index.ts";

const POTETO_ONE_LINER =
	"New task? Playbook match or rigor needed -> apply /poteto-mode. Casual turn or user opts out -> don't.";

const SLUG_CONFIG = parseConfig({
	version: 1,
	roles: { "bug-fix": "anthropic/claude-opus-4-6" },
});

describe("systemPromptInjection", () => {
	it("injects only the Poteto Mode one-liner when the mode is on", () => {
		assert.equal(systemPromptInjection(defaultConfig(), true), POTETO_ONE_LINER);
	});

	it("injects no Poteto Mode text when the mode is off", () => {
		assert.equal(systemPromptInjection(defaultConfig(), false), "");
		assert.equal(systemPromptInjection(SLUG_CONFIG, false), "bug-fix: anthropic/claude-opus-4-6");
	});

	it("still injects a configured role slug with Poteto Mode on", () => {
		assert.equal(
			systemPromptInjection(SLUG_CONFIG, true),
			`bug-fix: anthropic/claude-opus-4-6\n\n${POTETO_ONE_LINER}`,
		);
	});
});

const mode = (enabled: unknown): ModeEntry => ({
	type: "custom",
	customType: "pstack-mode",
	data: { enabled },
});

const other = (): ModeEntry => ({ type: "custom", customType: "unrelated", data: {} });

describe("sessionPotetoMode", () => {
	it("is on for a fresh session", () => {
		assert.equal(sessionPotetoMode([]), true);
		assert.equal(sessionPotetoMode([other()]), true);
	});

	it("honors an explicit off recorded in the session", () => {
		assert.equal(sessionPotetoMode([mode(false)]), false);
		assert.equal(sessionPotetoMode([other(), mode(false)]), false);
	});

	it("honors an explicit on recorded in the session", () => {
		assert.equal(sessionPotetoMode([mode(true)]), true);
	});

	it("takes the last recorded toggle", () => {
		assert.equal(sessionPotetoMode([mode(true), mode(false)]), false);
		assert.equal(sessionPotetoMode([mode(false), mode(true)]), true);
	});

	it("reads a non-boolean payload as falsy, so off stays off", () => {
		assert.equal(sessionPotetoMode([mode("yes")]), true);
		assert.equal(sessionPotetoMode([mode(null)]), false);
	});
});
