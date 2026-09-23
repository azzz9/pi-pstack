import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextMarkers, latestMarkerIsActive, type ContextMarker } from "./skill-context.ts";

const RULES = "pstack-poteto-rules";
const OFF = "pstack-poteto-off";

// A custom message carries role "custom" in buildSessionContext().messages and
// type "custom_message" in buildContextEntries(), so both shapes are markers.
const contextMessage = (customType: string): ContextMarker => ({ role: "custom", customType });
const contextEntry = (customType: string): ContextMarker => ({ type: "custom_message", customType });
const stateEntry = (customType: string): ContextMarker => ({ type: "custom", customType });
const ordinaryMessage = (): ContextMarker => ({ role: "user" });

describe("latestMarkerIsActive", () => {
	it("reads an active marker alone as active", () => {
		assert.equal(latestMarkerIsActive([contextMessage(RULES)], RULES, OFF), true);
		assert.equal(latestMarkerIsActive([contextEntry(RULES)], RULES, OFF), true);
	});

	it("reads a disabled marker after an active one as inactive", () => {
		assert.equal(
			latestMarkerIsActive([contextMessage(RULES), contextEntry(OFF)], RULES, OFF),
			false,
		);
	});

	it("reads an active marker after a disabled one as active again", () => {
		assert.equal(
			latestMarkerIsActive([contextEntry(OFF), contextMessage(RULES)], RULES, OFF),
			true,
		);
	});

	it("ignores unrelated custom messages, ordinary messages, and state entries", () => {
		assert.equal(
			latestMarkerIsActive(
				[contextMessage(RULES), contextMessage("other-ext"), ordinaryMessage(), contextMessage(RULES)],
				RULES,
				OFF,
			),
			true,
		);
		assert.equal(
			latestMarkerIsActive(
				[contextMessage(RULES), contextMessage("other-ext"), ordinaryMessage(), stateEntry(OFF)],
				RULES,
				OFF,
			),
			true,
		);
	});
});

describe("contextMarkers", () => {
	it("returns [] for an empty or non-object session manager", () => {
		assert.deepEqual(contextMarkers({}), []);
		assert.deepEqual(contextMarkers(null), []);
		assert.equal(latestMarkerIsActive(contextMarkers({}), RULES, OFF), false);
	});

	it("returns [] when buildSessionContext throws", () => {
		const sessionManager = {
			buildSessionContext: () => {
				throw new Error("boom");
			},
		};
		assert.deepEqual(contextMarkers(sessionManager), []);
		assert.equal(latestMarkerIsActive(contextMarkers(sessionManager), RULES, OFF), false);
	});

	it("falls back to buildContextEntries when buildSessionContext is absent", () => {
		const sessionManager = {
			buildContextEntries: () => [contextEntry(RULES), contextEntry(OFF)],
		};
		assert.deepEqual(contextMarkers(sessionManager), [contextEntry(RULES), contextEntry(OFF)]);
		assert.equal(latestMarkerIsActive(contextMarkers(sessionManager), RULES, OFF), false);
	});

	it("returns [] when a context build returns a non-array", () => {
		const sessionManager = {
			buildSessionContext: () => ({ messages: "not-an-array" as unknown as ContextMarker[] }),
		};
		assert.deepEqual(contextMarkers(sessionManager), []);
	});
});