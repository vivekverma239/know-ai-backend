import type { CallbackTokenUsage } from "./tokenUsage";

export interface Subsection {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
}

export interface SubsectionAPI {
  id: string;
  title: string;
  start_page: number;
  end_page: number;
  subsection_summary: string;
}

export interface Section {
  id: string;
  title: string;
  start_page: number;
  end_page: number;
  subsections: SubsectionAPI[];
  section_summary: string;
}

export interface Chapter {
  title: string;
  summary: string;
  start_page: number;
  end_page: number;
  sections: Section[];
}

export interface SectionCallbackDataV2 {
  chapters: Chapter[];
  title: string;
  summary: string;
}

export interface SectionCallbackData {
  chapters: Chapter[];
  title: string;
  summary: string;
  usage_metadata: CallbackTokenUsage;
}
