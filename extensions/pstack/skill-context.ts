// The marker approach mirrors i-have-adhd's extensions/context-compat.ts (MIT).

export type ContextMarker = { type?: string; role?: string; customType?: string };

type CompatibleSessionManager = {
	buildSessionContext?: () => { messages: readonly ContextMarker[] };
	buildContextEntries?: () => readonly ContextMarker[];
};

export function contextMarkers(sessionManager: unknown): readonly ContextMarker[] {
	// Context inspection is advisory. If the session-manager API moves or a context
	// build throws, report "not present" so the caller re-injects instead of crashing.
	if (sessionManager === null || typeof sessionManager !== "object") return [];

	const compatible = sessionManager as CompatibleSessionManager;
	try {
		if (typeof compatible.buildSessionContext === "function") {
			const messages = compatible.buildSessionContext().messages;
			return Array.isArray(messages) ? messages : [];
		}
		if (typeof compatible.buildContextEntries === "function") {
			const entries = compatible.buildContextEntries();
			return Array.isArray(entries) ? entries : [];
		}
	} catch {
		return [];
	}
	return [];
}

export function latestMarkerIsActive(
	markers: readonly ContextMarker[],
	activeType: string,
	disabledType: string,
): boolean {
	let active = false;
	for (const marker of markers) {
		if (marker.role !== "custom" && marker.type !== "custom_message") continue;
		if (marker.customType === activeType) {
			active = true;
		} else if (marker.customType === disabledType) {
			active = false;
		}
	}
	return active;
}