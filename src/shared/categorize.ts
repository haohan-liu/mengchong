export { classifyBuiltin, activityGroups, activityLabels, productiveActivityKinds, resolvePresence } from "./activity.js";
import { classifyBuiltin } from "./activity.js";

export function categorize(processName: string, ...context: string[]) {
  return classifyBuiltin(processName, ...context).activityKind;
}
