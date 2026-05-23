import { terminateWorkerPoolSingleton } from "@pierre/diffs/worker";
import "./styles.css";
import { cleanupApp, createApp } from "./app";
import { isDiffPayload } from "./guards";
import { createReviewShell, showErrorShell, showLoadingShell } from "./reviewShell";

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const app = createApp(token);
const shell = createReviewShell(app);

showLoadingShell();

fetch(`/api/diff?token=${encodeURIComponent(token)}&_=${Date.now()}`, { cache: "no-store" })
  .then(async (res) => {
    if (!res.ok) throw new Error(await res.text());
    const data: unknown = await res.json();
    if (!isDiffPayload(data)) throw new Error("Invalid diff payload");
    return data;
  })
  .then((payload) => shell.mount(payload))
  .catch((e) => showErrorShell(e instanceof Error ? e.message : String(e)));

window.addEventListener("pagehide", () => {
  cleanupApp(app);
  terminateWorkerPoolSingleton();
});
