import type { CallbackTokenUsage } from "./tokenUsage";

export interface Cluster {
  start_page: number;
  end_page: number;
  cluster_summary: string;
}

export interface PageSummary {
  page_number: number;
  summary: string;
}

export interface Company {
  name: string;
  countries: string[];
  industry: string[];
  products_or_services: string[];
  customers: string[];
  suppliers: string[];
}

export interface DocumentMetadata {
  document_type: string;
  document_published_date?: string;
  industry: string;
  summary: string;
  short_summary: string;
  title: string;
  entities: string[];
  reference_period?: string;
  reference_period_end_date?: string;
  companies?: Company[];
  published_year: number;
}

export interface MetadataCallback {
  clusters: Cluster[];
  total_pages: number;
  page_summaries: PageSummary[];
  document_metadata: DocumentMetadata;
  usage_metadata: CallbackTokenUsage;
}

export interface DocumentMetadata {
  clusters: Cluster[];
  total_pages: number;
  page_summaries: PageSummary[];
  document_metadata: DocumentMetadata;
  usage_metadata: CallbackTokenUsage;
}
