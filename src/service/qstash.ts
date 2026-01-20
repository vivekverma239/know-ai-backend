import { Client } from "@upstash/qstash";
import { type QstashMessage } from "@/@types/queue";

export const qstashClient = new Client({
  token: process.env.QSTASH_TOKEN!,
  baseUrl:
    process.env.NODE_ENV === "development"
      ? "http://localhost:8080"
      : undefined,
  retry: {
    retries: 3,
    backoff: (retry_count: number) => 2 ** retry_count * 20,
  },
});

export const sendQstashMessage = async <T>(
  urlPath: string,
  data: QstashMessage<T>
) => {
  // Consider adding error handling here
  const url = `${process.env.APP_URL}/${urlPath}`;
  const res = await qstashClient.publishJSON({
    url,
    body: data,
    flowControl: {
      key: "pdf-parser",
      parallelism: 2,
    },
    timeout: 60 * 10,
  });
  return res;
};
