import { AppError } from "../errors.js";
import { installHerdrPlugin as installPluginWithHerdr } from "../../infra/herdr/client.js";

const WT_HERDR_PLUGIN_REPOSITORY = "leesangb/wt";

export async function installHerdrPlugin(): Promise<void> {
  const result = await installPluginWithHerdr(WT_HERDR_PLUGIN_REPOSITORY);

  if (!result.installed) {
    throw new AppError(`Could not install the Herdr plugin: ${result.error}`);
  }
}
