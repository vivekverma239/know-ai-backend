export enum AsyncEvent {
  WEB_SEARCH_TASK = "WEB_SEARCH_TASK",
}

export type WebSearchTaskEventData = {
  taskId: string;
};

export type AsyncEventData = {
  [AsyncEvent.WEB_SEARCH_TASK]: WebSearchTaskEventData;
};

export type AsyncEventPayload = {
  type: AsyncEvent;
  data: AsyncEventData[keyof AsyncEventData];
  userID?: string;
};

export interface TaskQueueConfig {
  provider: "google-cloud";
  projectId: string;
  location: string;
  queueName: string;
  serviceAccountKey?: string;
  endpoint: string;
}

export interface TaskOptions {
  payload: AsyncEventPayload;
  delay?: number; // Delay in seconds
  retryCount?: number;
  priority?: "high" | "normal" | "low";
}

export interface TaskStatus {
  status: "pending" | "running" | "completed" | "failed";
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface QueueStats {
  totalTasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  failedTasks: number;
}

export interface TaskQueueProvider {
  enqueueTask(options: TaskOptions): Promise<string>;
  getTaskStatus(taskId: string): Promise<TaskStatus>;
  deleteTask(taskId: string): Promise<void>;
  purgeQueue(): Promise<void>;
  getQueueStats(): Promise<QueueStats>;
}
