export type ParsedPDFPages = {
  page_number: number;
  content: string;
  page_images: {
    bounds: number[];
    image_id: string;
  }[];
};

export type ParsedPDFSummary = {
  title: string;
  short_summary: string;
  year: number;
  date: string;
  companies: string[];
  document_type: string;
};

export type ParsedPDFMetadata = {
  title: string;
  publication_date: string;
  year: string;
  summary: string;
  category: string;
  subcategory: string;
  id: string;
  financial_and_investment_document?: {
    document_type: string;
    reference_period: string;
    company: string;
    country: string;
    industry: string;
    sentiment: string;
  };
};

export type ParsedPDFChartBlocks = {
  reference_idx: string;
  parsed_data: string;
  page: number;
  idx: number;
  bounds: number[];
};
export type ParsedPDF = {
  title: string;
  summary: ParsedPDFSummary;
  metadata: ParsedPDFMetadata;
  pages: ParsedPDFPages[];
  chart_blocks: ParsedPDFChartBlocks[];
};
