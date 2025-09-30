export interface Cluster {
  start_page: number;
  end_page: number;
  title: string;
  cluster_summary: string;
}

export interface PageSummary {
  page_number: number;
  summary: string;
}

export interface LevelDataChildren {
  start_page: number;
  end_page: number;
  summary: string;
}

export interface LevelData {
  level: number;
  summary: string;
  title: string;
  start_page: number;
  end_page: number;
  children: LevelDataChildren[];
}

export interface HeirarchialIndexData {
  clusters: Cluster[];
  levels: LevelData[];
}
export interface HeirarchialIndexCallback {
  success: boolean;
  data: {
    clusters: Cluster[];
    levels: LevelData[];
  };
}
