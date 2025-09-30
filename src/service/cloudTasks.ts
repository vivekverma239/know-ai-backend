import { CloudTasksClient } from "@google-cloud/tasks";

type CreateTaskParams = {
  queue: string;
  location: string;
  projectId: string;
  url: string; // HTTP endpoint in this service that will execute the task
  payload: unknown;
  scheduleInSeconds?: number;
  oidcServiceAccountEmail?: string;
  audience?: string;
};

function getClient(projectId?: string) {
  const raw =
    process.env.GCP_SA_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (raw) {
    try {
      const json = JSON.parse(raw) as {
        client_email?: string;
        private_key?: string;
        project_id?: string;
      };
      return new CloudTasksClient({
        projectId: projectId || json.project_id,
        credentials: {
          client_email: json.client_email,
          private_key: json.private_key,
        },
      });
    } catch {
      // Fall back to default credentials
      return new CloudTasksClient();
    }
  }
  return new CloudTasksClient();
}

export async function enqueueHttpTask(params: CreateTaskParams) {
  const client = getClient(params.projectId);
  const parent = client.queuePath(
    params.projectId,
    params.location,
    params.queue
  );

  const task: any = {
    httpRequest: {
      httpMethod: "POST",
      url: params.url,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(params.payload)).toString("base64"),
    },
  };

  if (params.scheduleInSeconds && params.scheduleInSeconds > 0) {
    const now = new Date();
    task.scheduleTime = {
      seconds: Math.floor(now.getTime() / 1000) + params.scheduleInSeconds,
    };
  }

  if (params.oidcServiceAccountEmail) {
    task.httpRequest.oidcToken = {
      serviceAccountEmail: params.oidcServiceAccountEmail,
      audience: params.audience ?? params.url,
    };
  }

  const [response] = await client.createTask({ parent, task });
  return response.name;
}
