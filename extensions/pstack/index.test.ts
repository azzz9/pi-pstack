import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultConfig, parseConfig } from "./config.ts";
import pstackExtension, { type ModeEntry, sessionPotetoMode, systemPromptInjection } from "./index.ts";

const SLUG_CONFIG = parseConfig({
	version: 1,
	roles: { "bug-fix": "anthropic/claude-opus-4-6" },
});

describe("systemPromptInjection", () => {
	it("injects nothing for an empty role table", () => {
		assert.equal(systemPromptInjection(defaultConfig()), "");
	});

	it("injects a configured role slug", () => {
		assert.equal(systemPromptInjection(SLUG_CONFIG), "bug-fix: anthropic/claude-opus-4-6");
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

type SentMessage = { message: { customType: string; content: string; display: boolean }; options: { triggerTurn?: boolean } };

type Handler = (event: unknown, ctx: unknown) => Promise<{ action: string; text?: string }>;

type Command = { handler: (args: string, ctx: unknown) => Promise<void> };

function harness() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const sent: SentMessage[] = [];
	const userMessages: Array<{ content: string }> = [];
	const statuses: Array<string | undefined> = [];
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
			return () => {};
		},
		sendMessage: (message: SentMessage["message"], options: SentMessage["options"]) => {
			sent.push({ message, options });
		},
		sendUserMessage: (content: string) => {
			userMessages.push({ content });
		},
		appendEntry: () => {},
		registerCommand: (name: string, options: Command) => {
			commands.set(name, options);
		},
	};
	pstackExtension(pi as never);
	const ctx = {
		mode: "tui",
		ui: {
			setStatus: (_key: string, value: string | undefined) => {
				statuses.push(value);
			},
			notify: () => {},
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: { buildSessionContext: () => ({ messages: [] }) },
	};
	return { handlers, commands, sent, userMessages, statuses, ctx };
}

describe("poteto skill command", () => {
	it("injects the rules once and forwards the task without expanding a second body", async () => {
		const { handlers, sent, userMessages, ctx } = harness();
		const input = handlers.get("input");
		assert.ok(input, "the extension registers an input handler");

		const result = await input({ type: "input", text: "/skill:poteto-mode fix the drift check", source: "interactive" }, ctx);

		assert.equal(result.action, "transform", "the command is dropped so pi runs the plain task");
		assert.equal(result.text, "fix the drift check");
		assert.equal(sent.length, 1, "the rules land as one custom message");
		assert.equal(sent[0].message.customType, "pstack-poteto-rules");
		assert.equal(sent[0].message.display, false, "the rules stay out of the transcript");
		assert.equal(sent[0].options.triggerTurn, false, "injecting the rules starts no turn");
		assert.match(sent[0].message.content, /^POTETO MODE IS ON\./);
		assert.match(sent[0].message.content, /Poteto Mode is on when a session starts/);
		assert.match(sent[0].message.content, /References are relative to .*skills\/poteto-mode\./);
		assert.deepEqual(userMessages, [], "the handler never sends a user message itself");
	});

	it("injects the rules and sends nothing for a bare skill command", async () => {
		const { handlers, sent, userMessages, ctx } = harness();
		const input = handlers.get("input");
		assert.ok(input);

		const result = await input({ type: "input", text: "/skill:poteto-mode", source: "interactive" }, ctx);

		assert.equal(result.action, "handled");
		assert.equal(sent.length, 1);
		assert.deepEqual(userMessages, [], "a bare command sends nothing to the model");
	});

	it("leaves ordinary input to pi", async () => {
		const { handlers, sent, userMessages, ctx } = harness();
		const input = handlers.get("input");
		assert.ok(input);

		const result = await input({ type: "input", text: "fix the bug", source: "interactive" }, ctx);

		assert.equal(result.action, "continue");
		assert.deepEqual(sent, []);
		assert.deepEqual(userMessages, []);
	});

	it("runs the command's task as a turn-triggering message, never a nested prompt", async () => {
		const { commands, sent, userMessages, ctx } = harness();
		const command = commands.get("poteto-mode");
		assert.ok(command, "the extension registers the poteto-mode command");

		await command.handler("fix the drift check", ctx);

		assert.deepEqual(sent.map((entry) => entry.message.customType), ["pstack-poteto-rules", "pstack-poteto-task"]);
		assert.equal(sent[1].message.content, "fix the drift check");
		assert.equal(sent[1].options.triggerTurn, true, "the task starts its own turn");
		assert.deepEqual(userMessages, [], "a nested prompt would hang pi's print mode");
	});

	it("shows the ADHD dot chip while on and clears it when off", async () => {
		const { commands, statuses, ctx } = harness();
		const command = commands.get("poteto-mode");
		assert.ok(command);

		await command.handler("", ctx);
		assert.equal(statuses.at(-1), "● Poteto ON", "the chip carries the theme-colored dot and the mode name");

		await command.handler("off", ctx);
		assert.equal(statuses.at(-1), undefined, "off clears the chip");
	});
});
