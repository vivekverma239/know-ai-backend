export type FileProcessingData = {
  fileId: string;
  userId: string;
};

export type WebSearchProcessingData = {
  taskId: string;
};

export type ToCMetaProcessingData = {
  fileId: string;
};

export type ReportContinuationData = {
  reportId: string;
};

export type QstashMessage<T> = {
  type:
    | "file_processing"
    | "web_search_processing"
    | "structured_report_processing"
    | "toc_meta_processing"
    | "report_continuation";
  data: T;
};
