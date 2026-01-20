export type FileProcessingData = {
  fileId: string;
  userId: string;
};

export type WebSearchProcessingData = {
  taskId: string;
};

export type QstashMessage<T> = {
  type: "file_processing" | "web_search_processing" | "structured_report_processing";
  data: T;
};
