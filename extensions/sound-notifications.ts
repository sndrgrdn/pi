import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export default function soundNotifications(pi: ExtensionAPI): void {
	const agentSoundPath = join(homedir(), ".pi/agent/audio/session-end.aac");

	async function play(path: string): Promise<void> {
		if (!existsSync(path)) return;
		await pi.exec("afplay", [path], { timeout: 10_000 });
	}

	function notify(path: string): void {
		void play(path);
	}

	pi.on("agent_end", () => {
		notify(agentSoundPath);
	});
}
