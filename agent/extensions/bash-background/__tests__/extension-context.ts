import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createExtensionRuntime,
  ExtensionRunner,
  initTheme,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export async function createToolContext() {
  initTheme("dark");

  const models = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
  });

  const runtime = createExtensionRuntime();
  runtime.getThinkingLevel = () => "off";

  const runner = new ExtensionRunner(
    [],
    runtime,
    process.cwd(),
    SessionManager.inMemory(process.cwd()),
    new ModelRegistry(models),
  );

  return runner.createToolContext("test", undefined);
}
