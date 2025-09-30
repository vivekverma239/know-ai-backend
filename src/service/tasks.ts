import { logger } from "../utils/logger";

export type TaskName =
  | "web_search_processing"
  | "parse_pdf"
  | "recompute_embeddings";

export type TaskPayload = Record<string, unknown> & {
  userId?: string;
  orgId?: string;
};

type TaskHandler = (payload: TaskPayload) => Promise<void>;

const registry: Record<TaskName, TaskHandler> = Object.create(null);

export function registerTask(name: TaskName, handler: TaskHandler) {
  registry[name] = handler;
}

export async function runTask(name: TaskName, payload: TaskPayload) {
  const handler = registry[name];
  if (!handler) {
    throw new Error(`No handler registered for task: ${name}`);
  }
  logger.info(`Executing task: ${name}`);
  await handler(payload);
}
