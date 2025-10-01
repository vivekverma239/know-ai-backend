import { CloudTasksClient, protos } from "@google-cloud/tasks";
import {
  type TaskQueueConfig,
  type TaskOptions,
  type TaskStatus,
  type QueueStats,
} from "@/@types/taskQueue";
import { err, ok, Result } from "neverthrow";
import { logger } from "@/utils/logger";

type ITask = protos.google.cloud.tasks.v2.ITask;

export class GoogleCloudTasksProvider {
  private config: TaskQueueConfig;
  private client!: CloudTasksClient;
  private queuePath: string;

  constructor(config: TaskQueueConfig) {
    this.config = config;
    this.queuePath = `projects/${config.projectId}/locations/${config.location}/queues/${config.queueName}`;
    this.initializeClient();
  }

  private async initializeClient(): Promise<void> {
    try {
      // Initialize the Google Cloud Tasks client
      this.client = new CloudTasksClient({
        keyFilename: this.config.serviceAccountKey,
      });

      // Verify the queue exists, create if it doesn't
      await this.ensureQueueExists();

      logger.info("initialized", {
        queueName: this.config.queueName,
        projectId: this.config.projectId,
        location: this.config.location,
      });
    } catch (error) {
      logger.error("Failed to initialize Google Cloud Tasks client", {
        message: "Failed to initialize Google Cloud Tasks client",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async ensureQueueExists(): Promise<void> {
    try {
      // Try to get the queue to see if it exists
      await this.client.getQueue({ name: this.queuePath });
      logger.info("exists", {
        queueName: this.config.queueName,
      });
    } catch (error: any) {
      // If queue doesn't exist (404), create it
      if (error.code === 5 || error.message?.includes("not found")) {
        logger.info("creating", {
          queueName: this.config.queueName,
        });

        const parent = `projects/${this.config.projectId}/locations/${this.config.location}`;

        await this.client.createQueue({
          parent,
          queue: {
            name: this.queuePath,
            rateLimits: {
              maxConcurrentDispatches: 100,
              maxDispatchesPerSecond: 500,
            },
            retryConfig: {
              maxAttempts: 5,
              maxRetryDuration: { seconds: 3600 }, // 1 hour
              minBackoff: { seconds: 0.1 },
              maxBackoff: { seconds: 3600 },
              maxDoublings: 16,
            },
          },
        });

        logger.info("created", {
          queueName: this.config.queueName,
        });
      } else {
        throw error;
      }
    }
  }

  async enqueueTask(options: TaskOptions): Promise<Result<string, Error>> {
    try {
      // Create the task request
      const task: ITask = {
        httpRequest: {
          httpMethod: "POST",
          url: `${this.config.endpoint}/api/v1/tasks/process`,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "TrainFit-TaskQueue/1.0",
            "X-API-Key": process.env.ASYNC_QUEUE_AUTH_KEY || "",
          },
          body: Buffer.from(JSON.stringify(options.payload)).toString("base64"),
        },
      };

      // Add scheduled time if delay is specified
      if (options.delay && options.delay > 0) {
        const scheduledTime = new Date();
        scheduledTime.setSeconds(scheduledTime.getSeconds() + options.delay);
        task.scheduleTime = {
          seconds: Math.floor(scheduledTime.getTime() / 1000),
        };
      }

      // Create the task
      const [response] = await this.client.createTask({
        parent: this.queuePath,
        task,
      });

      const taskId = response.name || `gcp-task-${Date.now()}`;

      logger.info("Task enqueued to Google Cloud Tasks", {
        message: "Task enqueued to Google Cloud Tasks",
        queueName: this.config.queueName,
        taskId,
        eventType: options.payload.type,
        delay: options.delay,
        priority: options.priority,
      });

      return ok(taskId);
    } catch (error) {
      logger.error("Failed to enqueue task to Google Cloud Tasks", {
        message: "Failed to enqueue task to Google Cloud Tasks",
        error: error instanceof Error ? error.message : String(error),
        eventType: options.payload.type,
        queueName: this.config.queueName,
      });
      return err(error as Error);
    }
  }

  async getTaskStatus(taskId: string): Promise<Result<TaskStatus, Error>> {
    try {
      const [response] = await this.client.getTask({ name: taskId });

      // Google Cloud Tasks doesn't provide detailed status information
      // We'll return a basic status based on whether the task exists
      const status: "pending" | "running" | "completed" | "failed" = "pending";

      return ok({
        status,
        createdAt: new Date(),
        // Google Cloud Tasks doesn't provide start/finish times for individual tasks
        startedAt: undefined,
        completedAt: undefined,
        error: undefined,
      });
    } catch (error) {
      logger.error("Failed to get task status from Google Cloud Tasks", {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(error as Error);
    }
  }

  async deleteTask(taskId: string): Promise<Result<void, Error>> {
    try {
      await this.client.deleteTask({ name: taskId });

      logger.info("Task deleted from Google Cloud Tasks", {
        message: "Task deleted from Google Cloud Tasks",
        taskId,
      });
      return ok(undefined);
    } catch (error) {
      logger.error("Failed to delete task from Google Cloud Tasks", {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(error as Error);
    }
  }

  async purgeQueue(): Promise<Result<void, Error>> {
    try {
      await this.client.purgeQueue({ name: this.queuePath });

      logger.info("purged", {
        queueName: this.config.queueName,
      });
      return ok(undefined);
    } catch (error) {
      logger.error("Failed to purge queue in Google Cloud Tasks", {
        message: "Failed to purge queue in Google Cloud Tasks",
        queueName: this.config.queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(error as Error);
    }
  }

  async getQueueStats(): Promise<Result<QueueStats, Error>> {
    try {
      const [response] = await this.client.getQueue({ name: this.queuePath });

      // Google Cloud Tasks doesn't provide detailed statistics like completed/failed tasks
      // We can only get basic queue information
      const stats = (response as any).stats;

      return ok({
        totalTasks: stats?.concurrentDispatchesCount || 0,
        pendingTasks: stats?.oldestEstimatedArrivalTime ? 1 : 0, // Simplified
        runningTasks: stats?.concurrentDispatchesCount || 0,
        completedTasks: 0, // Google Cloud Tasks doesn't track completed tasks
        failedTasks: 0, // Google Cloud Tasks doesn't track failed tasks
      });
    } catch (error) {
      logger.error("Failed to get queue stats from Google Cloud Tasks", {
        queueName: this.config.queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(error as Error);
    }
  }

  /**
   * Get detailed queue information
   */
  async getQueueInfo(): Promise<
    Result<
      {
        name: string;
        state: string;
        rateLimits?: {
          maxConcurrentDispatches: number;
          maxDispatchesPerSecond: number;
        };
        retryConfig?: {
          maxAttempts: number;
          maxRetryDuration: number;
        };
      },
      Error
    >
  > {
    try {
      const [response] = await this.client.getQueue({ name: this.queuePath });

      return ok({
        name: response.name || "",
        state: String(response.state || "UNKNOWN"),
        rateLimits: response.rateLimits
          ? {
              maxConcurrentDispatches:
                response.rateLimits.maxConcurrentDispatches || 0,
              maxDispatchesPerSecond:
                response.rateLimits.maxDispatchesPerSecond || 0,
            }
          : undefined,
        retryConfig: response.retryConfig
          ? {
              maxAttempts: response.retryConfig.maxAttempts || 0,
              maxRetryDuration: Number(
                response.retryConfig.maxRetryDuration?.seconds || 0
              ),
            }
          : undefined,
      });
    } catch (error) {
      logger.error("Failed to get queue info from Google Cloud Tasks", {
        queueName: this.config.queueName,
        error: error instanceof Error ? error.message : String(error),
      });
      return err(error as Error);
    }
  }
}
