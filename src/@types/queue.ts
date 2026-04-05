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

export type DocumentParseData = {
  fileId: string;
};

export type QstashMessage<T> = {
  type:
    | "file_processing"
    | "web_search_processing"
    | "structured_report_processing"
    | "toc_meta_processing"
    | "report_continuation"
    | "document_parse";
  data: T;
};
