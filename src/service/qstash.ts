import type { QstashMessage } from "@/@types/queue";
import { Client } from "@upstash/qstash";


export const sendQstashMessage = async <T>(urlPath: string, data: QstashMessage<T>) => {
  const qstashClient = new Client({
    token: process.env.QSTASH_TOKEN,
    baseUrl: process.env.QSTASH_URL,
    retry: {
      retries: 3,
      backoff: (retry_count: number) => 2 ** retry_count * 20,
    },
  });

  // Consider adding error handling here
  const url = `${process.env.APP_URL}/${urlPath}`;
  if (!process.env.QSTASH_TOKEN) {
    throw new Error("QSTASH_TOKEN is not set");
  }
  console.log(url, process.env.QSTASH_TOKEN);
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
