import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	LIST_ROLES,
	ROLE_NAMES,
	type PstackConfig,
	type RoleName,
	type RoleValue,
	configPath,
	defaultConfig,
	formatRoleTable,
	isSafeModelSelector,
	loadConfig,
	migrateLegacyMarkdownIfNeeded,
	saveConfig,
} from "./config.ts";
import { stripSkillsByLocationPrefix } from "./skill-strip.ts";
import { contextMarkers, latestMarkerIsActive } from "./skill-context.ts";

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

const POTETO_SKILL_COMMAND = "/skill:poteto-mode";
const POTETO_RULES_TYPE = "pstack-poteto-rules";
const POTETO_OFF_TYPE = "pstack-poteto-off";
const POTETO_SKILL_DIR = join(SKILLS_DIR, "poteto-mode");
const POTETO_HEADER = "POTETO MODE IS ON. The playbook and principle ruleset below governs this session.";
const POTETO_OFF_NOTICE =
	"POTETO MODE OFF. Ignore the poteto ruleset injected earlier in this conversation and return to your default response style.";

export function systemPromptInjection(config: PstackConfig): string {
	return formatRoleTable(config);
}

function stripFrontmatter(content: string): string {
	return content
		.replace(/^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, "")
		.trim();
}

function potetoRules(): string | undefined {
	let content: string;
	try {
		content = readFileSync(join(POTETO_SKILL_DIR, "SKILL.md"), "utf8");
	} catch {
		return undefined;
	}
	const body = stripFrontmatter(content);
	if (!body) return undefined;
	return `References are relative to ${POTETO_SKILL_DIR}.\n\n${body}`;
}

const POTETO_MODE_DEFAULT = true;

export type ModeEntry = {
	type?: string;
	customType?: string;
	data?: { enabled?: unknown };
};

function sessionEntries(ctx: ExtensionContext): ModeEntry[] {
	const sm = ctx.sessionManager as {
		getBranch?: () => ModeEntry[];
		getEntries: () => ModeEntry[];
	};
	return typeof sm.getBranch === "function" ? sm.getBranch() : sm.getEntries();
}

function lastPotetoEnabled(entries: ModeEntry[]): boolean | undefined {
	let enabled: boolean | undefined;
	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "pstack-mode") {
			enabled = Boolean(entry.data?.enabled);
		}
	}
	return enabled;
}

// Poteto Mode is on from the first turn. `/poteto-mode off` records off in this
// session's entries, so it wins here and lasts only as long as the session does.
export function sessionPotetoMode(entries: ModeEntry[]): boolean {
	return lastPotetoEnabled(entries) ?? POTETO_MODE_DEFAULT;
}

function stripCurrentMark(choice: string): string {
	return choice.endsWith(" (current)") ? choice.slice(0, -" (current)".length) : choice;
}

function labeledChoices(choices: string[], current: RoleValue | undefined): string[] {
	const currents = new Set(Array.isArray(current) ? current : current ? [current] : []);
	return choices.map((choice) => (currents.has(choice) ? `${choice} (current)` : choice));
}

function modelChoices(ctx: ExtensionCommandContext): string[] {
	const models =
		ctx.scopedModels.length > 0
			? ctx.scopedModels.map((entry) => entry.model)
			: ctx.modelRegistry.getAvailable();
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const model of models) {
		const key = `${model.provider}/${model.id}`;
		if (!isSafeModelSelector(key) || seen.has(key)) continue;
		seen.add(key);
		ids.push(key);
	}
	return ["inherit-parent", "auto", ...ids];
}

function isInheritSelector(value: string): boolean {
	return value === "inherit-parent" || value === "auto";
}

export default function pstackExtension(pi: ExtensionAPI): void {
	let potetoMode = false;

	// Same chip shape as i-have-adhd: a colored dot plus the mode name.
	function setStatus(ctx: ExtensionContext): void {
		if (ctx.mode !== "tui") return;
		if (!potetoMode) {
			ctx.ui.setStatus("pstack-mode", undefined);
			return;
		}
		const dot = ctx.ui.theme.fg("success", "●");
		const label = ctx.ui.theme.fg("accent", "Poteto ON");
		ctx.ui.setStatus("pstack-mode", `${dot} ${label}`);
	}

	function rulesInContext(ctx: ExtensionContext): boolean {
		return latestMarkerIsActive(
			contextMarkers(ctx.sessionManager),
			POTETO_RULES_TYPE,
			POTETO_OFF_TYPE,
		);
	}

	// Keep the context in sync with the mode: inject the skill body once as a
	// hidden custom message, and cancel it with a marker when the mode turns off.
	// Compaction drops the message, so the scan sees it missing and injects again.
	function syncContext(ctx: ExtensionContext): void {
		const injected = rulesInContext(ctx);
		if (potetoMode && !injected) {
			const rules = potetoRules();
			if (rules === undefined) {
				ctx.ui.notify("pstack: unable to read the poteto-mode skill body", "error");
			} else {
				pi.sendMessage(
					{
						customType: POTETO_RULES_TYPE,
						content: `${POTETO_HEADER}\n\n${rules}`,
						display: false,
					},
					// sendUserMessage would start a turn; this only records the message.
					{ triggerTurn: false },
				);
			}
		} else if (!potetoMode && injected) {
			pi.sendMessage(
				{
					customType: POTETO_OFF_TYPE,
					content: POTETO_OFF_NOTICE,
					display: false,
				},
				{ triggerTurn: false },
			);
		}
		setStatus(ctx);
	}

	function persistMode(enabled: boolean, ctx?: ExtensionContext): void {
		potetoMode = enabled;
		pi.appendEntry("pstack-mode", { enabled });
		if (ctx) syncContext(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		potetoMode = sessionPotetoMode(sessionEntries(ctx));
		syncContext(ctx);
		try {
			migrateLegacyMarkdownIfNeeded();
		} catch {
			// ignore migration errors
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		potetoMode = sessionPotetoMode(sessionEntries(ctx));
		syncContext(ctx);
	});

	pi.on("session_compact", async (_event, ctx) => syncContext(ctx));

	pi.on("input", async (event, ctx) => {
		const text = event.text.trim();
		if (text !== POTETO_SKILL_COMMAND && !text.startsWith(`${POTETO_SKILL_COMMAND} `)) {
			return { action: "continue" as const };
		}
		persistMode(true, ctx);
		ctx.ui.notify("Poteto Mode on for this session.", "info");
		const task = text.slice(POTETO_SKILL_COMMAND.length).trim();
		if (!task) {
			// The rules are already in context, so skip the skill expansion that
			// would inject a second copy of the body.
			return { action: "handled" as const };
		}
		// Drop the command and let Pi run the task. Sending a user message here
		// instead would re-enter the prompt path this handler runs inside.
		return { action: "transform" as const, text: task };
	});

	pi.on("before_agent_start", async (event) => {
		const config = loadConfig();
		const base = config.skillsEnabled
			? event.systemPrompt
			: stripSkillsByLocationPrefix(event.systemPrompt, SKILLS_DIR).prompt;
		const extra = systemPromptInjection(config);
		return {
			systemPrompt: extra ? `${base}\n\n${extra}` : base,
		};
	});

	pi.registerCommand("poteto-mode", {
		description:
			"Run a task with pstack Poteto Mode on. Usage: /poteto-mode [task] | /poteto-mode off",
		getArgumentCompletions: (prefix) => {
			const token = prefix.trim().toLowerCase();
			if (!token || "off".startsWith(token)) {
				return [{ value: "off", label: "off" }];
			}
			return null;
		},
		handler: async (args, ctx) => {
			const raw = args.trim();
			const token = raw.split(/\s+/)[0]?.toLowerCase() ?? "";
			if (token === "off" || token === "disable" || token === "stop") {
				persistMode(false, ctx);
				ctx.ui.notify("Poteto Mode off for this session. The next session starts with it on.", "info");
				return;
			}
			persistMode(true, ctx);
			ctx.ui.notify("Poteto Mode on for this session.", "info");
			if (raw) {
				// triggerTurn runs the task without re-entering the prompt path this
				// command handler already runs inside.
				pi.sendMessage(
					{ customType: "pstack-poteto-task", content: raw, display: true },
					{ triggerTurn: true },
				);
			}
		},
	});

	pi.registerCommand("setup-pstack", {
		description: "Map pstack delegation roles to models available in this Pi session.",
		handler: async (_args, ctx) => {
			try {
				migrateLegacyMarkdownIfNeeded();
			} catch {
				// ignore
			}
			const path = configPath();
			const config = loadConfig();
			if (!ctx.hasUI) {
				if (!existsSync(path) && !saveConfig(defaultConfig(), path)) {
					ctx.ui.notify(`Failed to write ${path}`, "error");
					return;
				}
				ctx.ui.notify(`Wrote ${path}`, "info");
				return;
			}

			const choices = modelChoices(ctx);
			for (const role of ROLE_NAMES) {
				const next = LIST_ROLES.has(role)
					? await pickListRole(ctx, role, choices, config.roles[role])
					: await pickScalarRole(ctx, role, choices, config.roles[role]);
				if (next === undefined) break;
				config.roles[role] = next;
			}

			if (!saveConfig(config, path)) {
				ctx.ui.notify(`Failed to write ${path}`, "error");
				return;
			}
			ctx.ui.notify(`Wrote ${path}`, "info");
		},
	});

	pi.registerCommand("pstack", {
		description: "Show or toggle whether pstack skills are listed in the system prompt. Usage: /pstack [on|off|status]",
		getArgumentCompletions: (prefix) => {
			const token = prefix.trim().toLowerCase();
			const options = ["on", "off", "status"].filter((value) => value.startsWith(token));
			if (options.length === 0) return null;
			return options.map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const token = args.trim().toLowerCase();
			const config = loadConfig();
			if (token === "" || token === "status") {
				const state = config.skillsEnabled ? "on" : "off";
				const hint = config.skillsEnabled ? "" : " Skills are hidden from the model; /skill:<name> still works.";
				ctx.ui.notify(`pstack is ${state}.${hint}`, "info");
				return;
			}
			const enabled = token === "on" || token === "enable";
			if (!enabled && token !== "off" && token !== "disable") {
				ctx.ui.notify("Usage: /pstack [on|off|status]", "error");
				return;
			}
			if (enabled !== config.skillsEnabled) {
				config.skillsEnabled = enabled;
				if (!saveConfig(config)) {
					ctx.ui.notify(`Failed to write ${configPath()}`, "error");
					return;
				}
			}
			ctx.ui.notify(
				enabled ? "pstack skills on." : "pstack skills off. Hidden from the model; /skill:<name> still works.",
				"info",
			);
		},
	});
}

async function pickScalarRole(
	ctx: ExtensionCommandContext,
	role: RoleName,
	choices: string[],
	current: RoleValue | undefined,
): Promise<RoleValue | undefined> {
	const choice = await ctx.ui.select(`Model for ${role}`, labeledChoices(choices, current));
	if (!choice) return undefined;
	return stripCurrentMark(choice);
}

async function pickListRole(
	ctx: ExtensionCommandContext,
	role: RoleName,
	choices: string[],
	current: RoleValue | undefined,
): Promise<RoleValue | undefined> {
	const first = await ctx.ui.select(`Model for ${role}`, labeledChoices(choices, current));
	if (!first) return undefined;
	const selected = stripCurrentMark(first);
	if (isInheritSelector(selected)) return selected;

	const picked = [selected];
	while (true) {
		const next = await ctx.ui.select("Add another model for this role?", ["done", ...choices]);
		if (!next) return undefined;
		if (next === "done") return picked;
		const value = stripCurrentMark(next);
		if (isInheritSelector(value)) return value;
		picked.push(value);
	}
}
