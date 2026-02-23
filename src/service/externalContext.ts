import { getDb } from "@/db";
import {
  type AssetType,
  accounts,
  calendarEvents,
  calendarEventsEntitiesRel,
  documents,
  entities,
  highlightComments,
  highlights,
  highlightsEntitiesRel,
  highlightsTagsRel,
  scenarioRemarks,
  scenarios,
  tags,
  trends,
  trendsAssets,
} from "@/db/external_schema";
import {
  type Column,
  type SQL,
  and,
  cosineDistance,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";

type DateInput = Date | string;

// Filters are optional and can be combined to shape the LLM context payload.
export type ExternalContextFilters = {
  teamId?: string;
  teamIds?: string[];
  entityIds?: number[];
  tagIds?: number[];
  assetTypes?: AssetType[];
  userIds?: string[];
  highlightIds?: number[];
  documentIds?: number[];
  from?: DateInput;
  to?: DateInput;
  limit?: number;
};

export type HighlightRow = typeof highlights.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type TrendRow = typeof trends.$inferSelect;
export type TrendAssetRow = typeof trendsAssets.$inferSelect;
export type ScenarioRow = typeof scenarios.$inferSelect;
export type ScenarioRemarkRow = typeof scenarioRemarks.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type HighlightCommentRow = typeof highlightComments.$inferSelect;
export type HighlightEntityRelRow = typeof highlightsEntitiesRel.$inferSelect;
export type HighlightTagRelRow = typeof highlightsTagsRel.$inferSelect;
export type CalendarEventEntityRelRow = typeof calendarEventsEntitiesRel.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;

export type HighlightItem = HighlightRow & {
  comments: HighlightCommentRow[];
  entities: HighlightEntityRelRow[];
  tags: HighlightTagRelRow[];
};

export type TrendItem = TrendRow & {
  assets: TrendAssetRow[];
};

export type ScenarioItem = ScenarioRow & {
  remarks: ScenarioRemarkRow[];
};

export type CalendarItem = CalendarEventRow & {
  entities: CalendarEventEntityRelRow[];
};

export type EntityContext = {
  entity: EntityRow | null;
  highlights: HighlightRow[];
  trends: TrendRow[];
  trendAssets: TrendAssetRow[];
  scenarioRemarks: ScenarioRemarkRow[];
  calendarEvents: CalendarEventRow[];
};

export type TagContext = {
  tag: TagRow | null;
  highlights: HighlightRow[];
};

export type UserContext = {
  userId: string;
  highlights: HighlightRow[];
  trends: TrendRow[];
  scenarios: ScenarioRow[];
  highlightComments: HighlightCommentRow[];
  calendarEvents: CalendarEventRow[];
};

export type AssetContext = {
  assetType: AssetType;
  trendAssets: TrendAssetRow[];
  scenarioRemarks: ScenarioRemarkRow[];
};

// Aggregated context returned for LLM report preparation.
export type ExternalContextResult = {
  highlights: {
    items: HighlightItem[];
  };
  taxonomy: {
    entities: EntityRow[];
    tags: TagRow[];
  };
  trends: {
    items: TrendItem[];
  };
  scenarios: {
    items: ScenarioItem[];
  };
  calendar: {
    items: CalendarItem[];
  };
  documents: DocumentRow[];
  groups: {
    byEntityId: Record<string, EntityContext>;
    byTagId: Record<string, TagContext>;
    byUserId: Record<string, UserContext>;
    byAssetType: Partial<Record<AssetType, AssetContext>>;
  };
};

export type HighlightsContextResult = {
  highlights: {
    items: HighlightItem[];
  };
  taxonomy: {
    entities: EntityRow[];
    tags: TagRow[];
  };
};

export type TrendsContextResult = {
  trends: {
    items: TrendItem[];
  };
};

export type ScenariosContextResult = {
  scenarios: {
    items: ScenarioItem[];
  };
};

export type CalendarContextResult = {
  calendar: {
    items: CalendarItem[];
  };
};

export type PaginationOptions = {
  limit?: number;
  offset?: number;
};

const MAX_LIMIT = 200;

const clampLimit = (limit?: number) => Math.min(limit ?? 50, MAX_LIMIT);

const applyPagination = <
  T extends {
    limit: (value: number) => unknown;
    offset?: (value: number) => unknown;
  },
>(
  query: T,
  limit: number,
  offset?: number,
) => {
  const limited = query.limit(limit) as T;
  return typeof offset === "number" && limited.offset ? limited.offset(offset) : limited;
};

const normalizeDate = (value?: DateInput) => (value ? new Date(value) : undefined);

const andWhere = (...clauses: Array<SQL | undefined>) => {
  const filtered = clauses.filter(Boolean) as SQL[];
  return filtered.length ? and(...filtered) : undefined;
};

const buildTeamFilter = (filters: ExternalContextFilters, column: Column): SQL | undefined => {
  if (filters.teamIds?.length) return inArray(column, filters.teamIds);
  if (filters.teamId) return eq(column, filters.teamId);
  return undefined;
};

const intersectIds = (left: number[] | undefined, right: number[]) => {
  if (!left) return right;
  const rightSet = new Set(right);
  return left.filter((id) => rightSet.has(id));
};

const emptyResult = (): ExternalContextResult => ({
  highlights: {
    items: [],
  },
  taxonomy: {
    entities: [],
    tags: [],
  },
  trends: {
    items: [],
  },
  scenarios: {
    items: [],
  },
  calendar: {
    items: [],
  },
  documents: [],
  groups: {
    byEntityId: {},
    byTagId: {},
    byUserId: {},
    byAssetType: {},
  },
});

// Resolve highlight IDs when filtering by related tags/entities.
const buildHighlightIdFilter = async (filters: ExternalContextFilters) => {
  let highlightIds = filters.highlightIds ? [...filters.highlightIds] : undefined;

  if (filters.tagIds?.length) {
    const tagHighlightRows = await getDb()
      .select({ highlightId: highlightsTagsRel.highlightId })
      .from(highlightsTagsRel)
      .where(inArray(highlightsTagsRel.tagId, filters.tagIds));
    highlightIds = intersectIds(
      highlightIds,
      tagHighlightRows.map((row) => Number(row.highlightId)),
    );
  }

  if (filters.entityIds?.length) {
    const entityHighlightRows = await getDb()
      .select({ highlightId: highlightsEntitiesRel.highlightId })
      .from(highlightsEntitiesRel)
      .where(inArray(highlightsEntitiesRel.entityId, filters.entityIds));
    highlightIds = intersectIds(
      highlightIds,
      entityHighlightRows.map((row) => Number(row.highlightId)),
    );
  }

  return highlightIds;
};

const buildHighlightItems = ({
  highlightRows,
  highlightEntities,
  highlightTags,
  commentRows,
}: {
  highlightRows: HighlightRow[];
  highlightEntities: HighlightEntityRelRow[];
  highlightTags: HighlightTagRelRow[];
  commentRows: HighlightCommentRow[];
}) => {
  const highlightItems = highlightRows.map((highlight) => ({
    ...highlight,
    comments: [] as HighlightCommentRow[],
    entities: [] as HighlightEntityRelRow[],
    tags: [] as HighlightTagRelRow[],
  }));
  const highlightItemsById = new Map(
    highlightItems.map((highlight) => [Number(highlight.id), highlight]),
  );

  for (const rel of highlightEntities) {
    const item = highlightItemsById.get(Number(rel.highlightId));
    if (item) item.entities.push(rel);
  }

  for (const rel of highlightTags) {
    const item = highlightItemsById.get(Number(rel.highlightId));
    if (item) item.tags.push(rel);
  }

  for (const commentRow of commentRows) {
    const item = highlightItemsById.get(Number(commentRow.highlightId));
    if (item) item.comments.push(commentRow);
  }

  return { highlightItems };
};

const buildTrendItems = ({
  trendRows,
  trendAssetRows,
}: {
  trendRows: TrendRow[];
  trendAssetRows: TrendAssetRow[];
}) => {
  const trendItems = trendRows.map((trend) => ({
    ...trend,
    assets: [] as TrendAssetRow[],
  }));
  const trendItemsById = new Map(trendItems.map((trend) => [Number(trend.id), trend]));
  for (const assetRow of trendAssetRows) {
    const item = trendItemsById.get(Number(assetRow.trendId));
    if (item) item.assets.push(assetRow);
  }
  return trendItems;
};

const buildScenarioItems = ({
  scenarioRows,
  scenarioRemarkRows,
}: {
  scenarioRows: ScenarioRow[];
  scenarioRemarkRows: ScenarioRemarkRow[];
}) => {
  const scenarioItems = scenarioRows.map((scenario) => ({
    ...scenario,
    remarks: [] as ScenarioRemarkRow[],
  }));
  const scenarioItemsById = new Map(
    scenarioItems.map((scenario) => [Number(scenario.id), scenario]),
  );
  for (const remarkRow of scenarioRemarkRows) {
    const item = scenarioItemsById.get(Number(remarkRow.scenarioId));
    if (item) item.remarks.push(remarkRow);
  }
  return scenarioItems;
};

const buildCalendarItems = ({
  calendarEventRows,
  calendarEventEntities,
}: {
  calendarEventRows: CalendarEventRow[];
  calendarEventEntities: CalendarEventEntityRelRow[];
}) => {
  const calendarItems = calendarEventRows.map((event) => ({
    ...event,
    entities: [] as CalendarEventEntityRelRow[],
  }));
  const calendarItemsById = new Map(calendarItems.map((event) => [Number(event.id), event]));
  for (const rel of calendarEventEntities) {
    const item = calendarItemsById.get(Number(rel.calendarEventId));
    if (item) item.entities.push(rel);
  }
  return calendarItems;
};

const fetchHighlights = async ({
  filters,
  highlightIdFilter,
  from,
  to,
  limit,
  offset,
}: {
  filters: ExternalContextFilters;
  highlightIdFilter?: number[];
  from?: Date;
  to?: Date;
  limit: number;
  offset?: number;
}): Promise<HighlightRow[]> => {
  const highlightWhere = andWhere(
    buildTeamFilter(filters, highlights.teamId),
    highlightIdFilter?.length ? inArray(highlights.id, highlightIdFilter) : undefined,
    from ? gte(highlights.createdAt, from) : undefined,
    to ? lte(highlights.createdAt, to) : undefined,
  );
  const highlightsQuery = getDb().select(selectHighlights).from(highlights);
  const ordered = (
    highlightWhere ? highlightsQuery.where(highlightWhere) : highlightsQuery
  ).orderBy(desc(highlights.createdAt));
  return (await applyPagination(ordered, limit, offset)) as HighlightRow[];
};

const fetchHighlightEntities = async ({
  filters,
  highlightIdScope,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
}) => {
  const highlightEntityWhere = andWhere(
    highlightIdScope?.length
      ? inArray(highlightsEntitiesRel.highlightId, highlightIdScope)
      : undefined,
    filters.entityIds?.length
      ? inArray(highlightsEntitiesRel.entityId, filters.entityIds)
      : undefined,
  );
  const highlightEntityQuery = getDb()
    .select({
      highlightId: highlightsEntitiesRel.highlightId,
      entityId: highlightsEntitiesRel.entityId,
      userDefined: highlightsEntitiesRel.userDefined,
    })
    .from(highlightsEntitiesRel);
  return highlightEntityWhere
    ? highlightEntityQuery.where(highlightEntityWhere)
    : highlightEntityQuery;
};

const fetchHighlightTags = async ({
  filters,
  highlightIdScope,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
}) => {
  const highlightTagWhere = andWhere(
    highlightIdScope?.length ? inArray(highlightsTagsRel.highlightId, highlightIdScope) : undefined,
    filters.tagIds?.length ? inArray(highlightsTagsRel.tagId, filters.tagIds) : undefined,
  );
  const highlightTagQuery = getDb()
    .select({
      highlightId: highlightsTagsRel.highlightId,
      tagId: highlightsTagsRel.tagId,
    })
    .from(highlightsTagsRel);
  return highlightTagWhere ? highlightTagQuery.where(highlightTagWhere) : highlightTagQuery;
};

const fetchEntities = async ({
  entityIds,
  limit,
}: {
  entityIds: Set<number>;
  limit: number;
}) => {
  const entitiesQuery = getDb().select(selectEntities).from(entities);
  const entitiesWhere = entityIds.size ? inArray(entities.id, Array.from(entityIds)) : undefined;
  return (entitiesWhere ? entitiesQuery.where(entitiesWhere) : entitiesQuery)
    .orderBy(entities.name)
    .limit(limit);
};

const fetchTags = async ({
  tagIds,
  filters,
  limit,
}: {
  tagIds: Set<number>;
  filters: ExternalContextFilters;
  limit: number;
}) => {
  const tagsQuery = getDb().select(selectTags).from(tags);
  const tagsWhere = tagIds.size
    ? inArray(tags.id, Array.from(tagIds))
    : buildTeamFilter(filters, tags.teamId);
  return (tagsWhere ? tagsQuery.where(tagsWhere) : tagsQuery).orderBy(tags.name).limit(limit);
};

const fetchTrends = async ({
  filters,
  highlightIdScope,
  from,
  to,
  limit,
  offset,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
  from?: Date;
  to?: Date;
  limit: number;
  offset?: number;
}): Promise<TrendRow[]> => {
  const trendWhere = andWhere(
    highlightIdScope?.length ? inArray(trends.highlightId, highlightIdScope) : undefined,
    filters.entityIds?.length ? inArray(trends.entityId, filters.entityIds) : undefined,
    buildTeamFilter(filters, trends.teamId),
    filters.userIds?.length ? inArray(trends.authorId, filters.userIds) : undefined,
    from ? gte(trends.createdAt, from) : undefined,
    to ? lte(trends.createdAt, to) : undefined,
  );
  const trendsQuery = getDb().select(selectTrends).from(trends);
  const ordered = (trendWhere ? trendsQuery.where(trendWhere) : trendsQuery).orderBy(
    desc(trends.createdAt),
  );
  return (await applyPagination(ordered, limit, offset)) as TrendRow[];
};

const fetchTrendAssets = async ({
  filters,
  highlightIdScope,
  from,
  to,
  limit,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
  from?: Date;
  to?: Date;
  limit: number;
}) => {
  const trendAssetWhere = andWhere(
    highlightIdScope?.length ? inArray(trendsAssets.highlightId, highlightIdScope) : undefined,
    filters.entityIds?.length ? inArray(trendsAssets.entityId, filters.entityIds) : undefined,
    filters.assetTypes?.length ? inArray(trendsAssets.type, filters.assetTypes) : undefined,
    from ? gte(trendsAssets.createdAt, from) : undefined,
    to ? lte(trendsAssets.createdAt, to) : undefined,
  );
  const trendAssetsQuery = getDb().select(selectTrendAssets).from(trendsAssets);
  return (trendAssetWhere ? trendAssetsQuery.where(trendAssetWhere) : trendAssetsQuery)
    .orderBy(desc(trendsAssets.createdAt))
    .limit(limit);
};

const fetchTrendAssetsByTrendIds = async ({
  trendIds,
  assetTypes,
  entityIds,
  limit,
}: {
  trendIds: number[];
  assetTypes?: AssetType[];
  entityIds?: number[];
  limit: number;
}) => {
  if (!trendIds.length) return [];
  const trendAssetWhere = andWhere(
    inArray(trendsAssets.trendId, trendIds),
    assetTypes?.length ? inArray(trendsAssets.type, assetTypes) : undefined,
    entityIds?.length ? inArray(trendsAssets.entityId, entityIds) : undefined,
  );
  const trendAssetsQuery = getDb().select(selectTrendAssets).from(trendsAssets);
  return (trendAssetWhere ? trendAssetsQuery.where(trendAssetWhere) : trendAssetsQuery)
    .orderBy(desc(trendsAssets.createdAt))
    .limit(limit);
};

const fetchScenarios = async ({
  filters,
  highlightIdScope,
  from,
  to,
  limit,
  offset,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
  from?: Date;
  to?: Date;
  limit: number;
  offset?: number;
}): Promise<ScenarioRow[]> => {
  const scenarioWhere = andWhere(
    highlightIdScope?.length ? inArray(scenarios.highlightId, highlightIdScope) : undefined,
    buildTeamFilter(filters, scenarios.teamId),
    filters.userIds?.length ? inArray(scenarios.authorId, filters.userIds) : undefined,
    from ? gte(scenarios.createdAt, from) : undefined,
    to ? lte(scenarios.createdAt, to) : undefined,
  );
  const scenariosQuery = getDb().select(selectScenarios).from(scenarios);
  const ordered = (scenarioWhere ? scenariosQuery.where(scenarioWhere) : scenariosQuery).orderBy(
    desc(scenarios.createdAt),
  );
  return (await applyPagination(ordered, limit, offset)) as ScenarioRow[];
};

const fetchScenarioRemarks = async ({
  filters,
  from,
  to,
  limit,
}: {
  filters: ExternalContextFilters;
  from?: Date;
  to?: Date;
  limit: number;
}) => {
  const scenarioRemarkWhere = andWhere(
    filters.entityIds?.length ? inArray(scenarioRemarks.entityId, filters.entityIds) : undefined,
    filters.assetTypes?.length ? inArray(scenarioRemarks.asset, filters.assetTypes) : undefined,
    buildTeamFilter(filters, scenarioRemarks.teamId),
    from ? gte(scenarioRemarks.createdAt, from) : undefined,
    to ? lte(scenarioRemarks.createdAt, to) : undefined,
  );
  const scenarioRemarksQuery = getDb().select(selectScenarioRemarks).from(scenarioRemarks);
  return (
    scenarioRemarkWhere ? scenarioRemarksQuery.where(scenarioRemarkWhere) : scenarioRemarksQuery
  )
    .orderBy(desc(scenarioRemarks.createdAt))
    .limit(limit);
};

const fetchScenarioRemarksByScenarioIds = async ({
  scenarioIds,
  assetTypes,
  entityIds,
  limit,
}: {
  scenarioIds: number[];
  assetTypes?: AssetType[];
  entityIds?: number[];
  limit: number;
}) => {
  if (!scenarioIds.length) return [];
  const scenarioRemarkWhere = andWhere(
    inArray(scenarioRemarks.scenarioId, scenarioIds),
    assetTypes?.length ? inArray(scenarioRemarks.asset, assetTypes) : undefined,
    entityIds?.length ? inArray(scenarioRemarks.entityId, entityIds) : undefined,
  );
  const scenarioRemarksQuery = getDb().select(selectScenarioRemarks).from(scenarioRemarks);
  return (
    scenarioRemarkWhere ? scenarioRemarksQuery.where(scenarioRemarkWhere) : scenarioRemarksQuery
  )
    .orderBy(desc(scenarioRemarks.createdAt))
    .limit(limit);
};

const fetchCalendarEvents = async ({
  filters,
  highlightIdScope,
  from,
  to,
  limit,
  offset,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
  from?: Date;
  to?: Date;
  limit: number;
  offset?: number;
}): Promise<CalendarEventRow[]> => {
  const calendarEventWhere = andWhere(
    highlightIdScope?.length ? inArray(calendarEvents.highlightId, highlightIdScope) : undefined,
    buildTeamFilter(filters, calendarEvents.teamId),
    filters.userIds?.length ? inArray(calendarEvents.authorId, filters.userIds) : undefined,
    from ? gte(calendarEvents.createdAt, from) : undefined,
    to ? lte(calendarEvents.createdAt, to) : undefined,
  );
  const calendarEventsQuery = getDb().select(selectCalendarEvents).from(calendarEvents);
  const ordered = (
    calendarEventWhere ? calendarEventsQuery.where(calendarEventWhere) : calendarEventsQuery
  ).orderBy(desc(calendarEvents.createdAt));
  return (await applyPagination(ordered, limit, offset)) as CalendarEventRow[];
};

const fetchCalendarEventEntities = async ({
  calendarEventRows,
  entityIds,
}: {
  calendarEventRows: CalendarEventRow[];
  entityIds?: number[];
}) => {
  const calendarEntityWhere = andWhere(
    calendarEventRows.length
      ? inArray(
          calendarEventsEntitiesRel.calendarEventId,
          calendarEventRows.map((row) => Number(row.id)),
        )
      : undefined,
    entityIds?.length ? inArray(calendarEventsEntitiesRel.entityId, entityIds) : undefined,
  );
  const calendarEntitiesQuery = getDb()
    .select({
      calendarEventId: calendarEventsEntitiesRel.calendarEventId,
      entityId: calendarEventsEntitiesRel.entityId,
    })
    .from(calendarEventsEntitiesRel);
  return calendarEntityWhere
    ? calendarEntitiesQuery.where(calendarEntityWhere)
    : calendarEntitiesQuery;
};

const fetchHighlightComments = async ({
  filters,
  highlightIdScope,
  from,
  to,
  limit,
}: {
  filters: ExternalContextFilters;
  highlightIdScope?: number[];
  from?: Date;
  to?: Date;
  limit: number;
}) => {
  const commentWhere = andWhere(
    highlightIdScope?.length ? inArray(highlightComments.highlightId, highlightIdScope) : undefined,
    buildTeamFilter(filters, highlightComments.teamId),
    filters.userIds?.length ? inArray(highlightComments.authorId, filters.userIds) : undefined,
    from ? gte(highlightComments.createdAt, from) : undefined,
    to ? lte(highlightComments.createdAt, to) : undefined,
  );
  const commentsQuery = getDb().select(selectHighlightComments).from(highlightComments);
  return (commentWhere ? commentsQuery.where(commentWhere) : commentsQuery)
    .orderBy(desc(highlightComments.createdAt))
    .limit(limit);
};

const fetchDocuments = async ({
  filters,
  limit,
}: {
  filters: ExternalContextFilters;
  limit: number;
}) => {
  const documentWhere = andWhere(
    filters.documentIds?.length ? inArray(documents.id, filters.documentIds) : undefined,
    buildTeamFilter(filters, documents.teamId),
  );
  const documentsQuery = getDb().select(selectDocuments).from(documents);
  return (documentWhere ? documentsQuery.where(documentWhere) : documentsQuery)
    .orderBy(desc(documents.createdAt))
    .limit(limit);
};

const buildGroups = ({
  highlightRows,
  highlightEntities,
  highlightTags,
  trendRows,
  trendAssetRows,
  scenarioRows,
  scenarioRemarkRows,
  calendarEventRows,
  calendarEventEntities,
  commentRows,
  entityIds,
  tagIds,
  entityRows,
  tagRows,
}: {
  highlightRows: HighlightRow[];
  highlightEntities: HighlightEntityRelRow[];
  highlightTags: HighlightTagRelRow[];
  trendRows: TrendRow[];
  trendAssetRows: TrendAssetRow[];
  scenarioRows: ScenarioRow[];
  scenarioRemarkRows: ScenarioRemarkRow[];
  calendarEventRows: CalendarEventRow[];
  calendarEventEntities: CalendarEventEntityRelRow[];
  commentRows: HighlightCommentRow[];
  entityIds: Set<number>;
  tagIds: Set<number>;
  entityRows: EntityRow[];
  tagRows: TagRow[];
}) => {
  const highlightsById = new Map(highlightRows.map((row) => [Number(row.id), row]));
  const { highlightItems } = buildHighlightItems({
    highlightRows,
    highlightEntities,
    highlightTags,
    commentRows,
  });
  const entitiesById = new Map(entityRows.map((row) => [Number(row.id), row]));
  const tagsById = new Map(tagRows.map((row) => [Number(row.id), row]));

  // Build grouped views for common report pivots.
  const byEntityId: Record<string, EntityContext> = {};
  for (const id of entityIds) {
    byEntityId[String(id)] = {
      entity: entitiesById.get(id) ?? null,
      highlights: [],
      trends: [],
      trendAssets: [],
      scenarioRemarks: [],
      calendarEvents: [],
    };
  }

  for (const rel of highlightEntities) {
    const highlight = highlightsById.get(Number(rel.highlightId));
    const bucket = byEntityId[String(rel.entityId)];
    if (highlight && bucket) bucket.highlights.push(highlight);
  }

  for (const trendRow of trendRows) {
    const bucket = byEntityId[String(trendRow.entityId)];
    if (bucket) bucket.trends.push(trendRow);
  }

  for (const trendAssetRow of trendAssetRows) {
    const bucket = byEntityId[String(trendAssetRow.entityId)];
    if (bucket) bucket.trendAssets.push(trendAssetRow);
  }

  for (const scenarioRemarkRow of scenarioRemarkRows) {
    const bucket = byEntityId[String(scenarioRemarkRow.entityId)];
    if (bucket) bucket.scenarioRemarks.push(scenarioRemarkRow);
  }

  const calendarEventById = new Map(calendarEventRows.map((row) => [Number(row.id), row]));
  for (const rel of calendarEventEntities) {
    const event = calendarEventById.get(Number(rel.calendarEventId));
    const bucket = byEntityId[String(rel.entityId)];
    if (event && bucket) bucket.calendarEvents.push(event);
  }

  const byTagId: Record<string, TagContext> = {};
  for (const id of tagIds) {
    byTagId[String(id)] = { tag: tagsById.get(id) ?? null, highlights: [] };
  }
  for (const rel of highlightTags) {
    const highlight = highlightsById.get(Number(rel.highlightId));
    const bucket = byTagId[String(rel.tagId)];
    if (highlight && bucket) bucket.highlights.push(highlight);
  }

  const byUserId: Record<string, UserContext> = {};
  const addUserBucket = (userId?: string | null) => {
    if (!userId) return undefined;
    const key = String(userId);
    if (!byUserId[key]) {
      byUserId[key] = {
        userId: key,
        highlights: [],
        trends: [],
        scenarios: [],
        highlightComments: [],
        calendarEvents: [],
      };
    }
    return byUserId[key];
  };

  for (const highlight of highlightRows) {
    const bucket = addUserBucket(highlight.authorId);
    if (bucket) bucket.highlights.push(highlight);
  }
  for (const trendRow of trendRows) {
    const bucket = addUserBucket(trendRow.authorId);
    if (bucket) bucket.trends.push(trendRow);
  }
  for (const scenarioRow of scenarioRows) {
    const bucket = addUserBucket(scenarioRow.authorId);
    if (bucket) bucket.scenarios.push(scenarioRow);
  }
  for (const commentRow of commentRows) {
    const bucket = addUserBucket(commentRow.authorId);
    if (bucket) bucket.highlightComments.push(commentRow);
  }
  for (const calendarEvent of calendarEventRows) {
    const bucket = addUserBucket(calendarEvent.authorId);
    if (bucket) bucket.calendarEvents.push(calendarEvent);
  }

  const byAssetType: Partial<Record<AssetType, AssetContext>> = {};
  const addAssetBucket = (assetType?: AssetType | null) => {
    if (!assetType) return undefined;
    if (!byAssetType[assetType]) {
      byAssetType[assetType] = {
        assetType,
        trendAssets: [],
        scenarioRemarks: [],
      };
    }
    return byAssetType[assetType];
  };

  for (const assetRow of trendAssetRows) {
    const bucket = addAssetBucket(assetRow.type ?? undefined);
    if (bucket) bucket.trendAssets.push(assetRow);
  }
  for (const remarkRow of scenarioRemarkRows) {
    const bucket = addAssetBucket(remarkRow.asset ?? undefined);
    if (bucket) bucket.scenarioRemarks.push(remarkRow);
  }

  const trendItems = buildTrendItems({ trendRows, trendAssetRows });
  const scenarioItems = buildScenarioItems({ scenarioRows, scenarioRemarkRows });
  const calendarItems = buildCalendarItems({
    calendarEventRows,
    calendarEventEntities,
  });

  return {
    highlightItems,
    trendItems,
    scenarioItems,
    calendarItems,
    byEntityId,
    byTagId,
    byUserId,
    byAssetType,
  };
};

const selectHighlights = {
  id: highlights.id,
  content: highlights.content,
  documentId: highlights.documentId,
  authorId: highlights.authorId,
  teamId: highlights.teamId,
  meta: highlights.meta,
  type: highlights.type,
  imageUrl: highlights.imageUrl,
  imageId: highlights.imageId,
  translationId: highlights.translationId,
  contentEmbedding: highlights.contentEmbedding,
  aiDescription: highlights.aiDescription,
  aiSummary: highlights.aiSummary,
  imageParsedContent: highlights.imageParsedContent,
  createdAt: highlights.createdAt,
  updatedAt: highlights.updatedAt,
};

const selectEntities = {
  id: entities.id,
  name: entities.name,
  uniqueId: entities.uniqueId,
  type: entities.type,
  description: entities.description,
  descriptionEmbedding: entities.descriptionEmbedding,
  createdAt: entities.createdAt,
  updatedAt: entities.updatedAt,
};

const selectTags = {
  id: tags.id,
  name: tags.name,
  description: tags.description,
  authorId: tags.authorId,
  teamId: tags.teamId,
  createdAt: tags.createdAt,
};

const selectTrends = {
  id: trends.id,
  documentId: trends.documentId,
  highlightId: trends.highlightId,
  entityId: trends.entityId,
  trend: trends.trend,
  comment: trends.comment,
  authorId: trends.authorId,
  teamId: trends.teamId,
  createdAt: trends.createdAt,
  updatedAt: trends.updatedAt,
};

const selectTrendAssets = {
  id: trendsAssets.id,
  trendId: trendsAssets.trendId,
  highlightId: trendsAssets.highlightId,
  documentId: trendsAssets.documentId,
  entityId: trendsAssets.entityId,
  trend: trendsAssets.trend,
  type: trendsAssets.type,
  value: trendsAssets.value,
  createdAt: trendsAssets.createdAt,
};

const selectScenarios = {
  id: scenarios.id,
  highlightId: scenarios.highlightId,
  documentId: scenarios.documentId,
  description: scenarios.description,
  implication: scenarios.implication,
  title: scenarios.title,
  tentative: scenarios.tentative,
  withTime: scenarios.withTime,
  probability: scenarios.probability,
  fromDate: scenarios.fromDate,
  toDate: scenarios.toDate,
  authorId: scenarios.authorId,
  teamId: scenarios.teamId,
  createdAt: scenarios.createdAt,
  updatedAt: scenarios.updatedAt,
};

const selectScenarioRemarks = {
  id: scenarioRemarks.id,
  scenarioId: scenarioRemarks.scenarioId,
  documentId: scenarioRemarks.documentId,
  entityId: scenarioRemarks.entityId,
  variation: scenarioRemarks.variation,
  asset: scenarioRemarks.asset,
  authorId: scenarioRemarks.authorId,
  teamId: scenarioRemarks.teamId,
  createdAt: scenarioRemarks.createdAt,
};

const selectCalendarEvents = {
  id: calendarEvents.id,
  highlightId: calendarEvents.highlightId,
  documentId: calendarEvents.documentId,
  description: calendarEvents.description,
  implication: calendarEvents.implication,
  tentative: calendarEvents.tentative,
  withTime: calendarEvents.withTime,
  fromDate: calendarEvents.fromDate,
  toDate: calendarEvents.toDate,
  authorId: calendarEvents.authorId,
  teamId: calendarEvents.teamId,
  createdAt: calendarEvents.createdAt,
};

const selectHighlightComments = {
  id: highlightComments.id,
  highlightId: highlightComments.highlightId,
  replyTo: highlightComments.replyTo,
  message: highlightComments.message,
  trend: highlightComments.trend,
  authorId: highlightComments.authorId,
  teamId: highlightComments.teamId,
  createdAt: highlightComments.createdAt,
};

const selectDocuments = {
  id: documents.id,
  type: documents.type,
  title: documents.title,
  teamId: documents.teamId,
  assetId: documents.assetId,
  assetUrl: documents.assetUrl,
  authorId: documents.authorId,
  documentUrl: documents.documentUrl,
  thumbnailUrl: documents.thumbnailUrl,
  createdAt: documents.createdAt,
  updatedAt: documents.updatedAt,
};

const selectAccounts = {
  id: accounts.id,
  name: accounts.name,
  email: accounts.email,
  slug: accounts.slug,
  pictureUrl: accounts.pictureUrl,
  organizationId: accounts.organizationId,
  accountType: accounts.accountType,
  isPersonalAccount: accounts.isPersonalAccount,
};

// Primary entry point: fetches external context and groups by common pivots.
export const getExternalContext = async (
  filters: ExternalContextFilters,
): Promise<ExternalContextResult> => {
  const limit = clampLimit(filters.limit);
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);

  // Pre-resolve related highlight IDs before fetching base rows.
  const highlightIdFilter = await buildHighlightIdFilter(filters);
  if (highlightIdFilter && highlightIdFilter.length === 0) {
    return emptyResult();
  }

  const highlightRows = await fetchHighlights({
    filters,
    highlightIdFilter,
    from,
    to,
    limit,
  });

  // Use the fetched highlights as the primary scope for related lookups.
  const highlightIds = highlightRows.map((row) => Number(row.id));
  const highlightIdScope = highlightIds.length ? highlightIds : highlightIdFilter;

  const highlightEntities = await fetchHighlightEntities({
    filters,
    highlightIdScope,
  });

  const highlightTags = await fetchHighlightTags({
    filters,
    highlightIdScope,
  });

  const entityIds = new Set<number>(
    filters.entityIds ?? highlightEntities.map((row) => Number(row.entityId)),
  );
  const tagIds = new Set<number>(filters.tagIds ?? highlightTags.map((row) => Number(row.tagId)));

  const entityRows = await fetchEntities({ entityIds, limit });

  const tagRows = await fetchTags({
    tagIds,
    filters,
    limit,
  });

  const trendRows = await fetchTrends({
    filters,
    highlightIdScope,
    from,
    to,
    limit,
  });

  const trendAssetRows = await fetchTrendAssets({
    filters,
    highlightIdScope,
    from,
    to,
    limit,
  });

  const scenarioRows = await fetchScenarios({
    filters,
    highlightIdScope,
    from,
    to,
    limit,
  });

  const scenarioRemarkRows = await fetchScenarioRemarks({
    filters,
    from,
    to,
    limit,
  });

  const calendarEventRows = await fetchCalendarEvents({
    filters,
    highlightIdScope,
    from,
    to,
    limit,
    offset: undefined,
  });

  const calendarEventEntities = await fetchCalendarEventEntities({
    calendarEventRows,
    entityIds: filters.entityIds,
  });

  const commentRows = await fetchHighlightComments({
    filters,
    highlightIdScope,
    from,
    to,
    limit,
  });

  const documentRows = await fetchDocuments({ filters, limit });

  const { highlightItems, trendItems, scenarioItems, calendarItems, ...groups } = buildGroups({
    highlightRows,
    highlightEntities,
    highlightTags,
    trendRows,
    trendAssetRows,
    scenarioRows,
    scenarioRemarkRows,
    calendarEventRows,
    calendarEventEntities,
    commentRows,
    entityIds,
    tagIds,
    entityRows,
    tagRows,
  });

  return {
    highlights: {
      items: highlightItems,
    },
    taxonomy: {
      entities: entityRows,
      tags: tagRows,
    },
    trends: {
      items: trendItems,
    },
    scenarios: {
      items: scenarioItems,
    },
    calendar: {
      items: calendarItems,
    },
    documents: documentRows,
    groups,
  };
};

export const getExternalEntityContext = async (
  entityId: number,
  filters: Omit<ExternalContextFilters, "entityIds">,
) => getExternalContext({ ...filters, entityIds: [entityId] });

export const getExternalTagContext = async (
  tagId: number,
  filters: Omit<ExternalContextFilters, "tagIds">,
) => getExternalContext({ ...filters, tagIds: [tagId] });

export const getExternalUserContext = async (
  userId: string,
  filters: Omit<ExternalContextFilters, "userIds">,
) => getExternalContext({ ...filters, userIds: [userId] });

export const getExternalAssetContext = async (
  assetType: AssetType,
  filters: Omit<ExternalContextFilters, "assetTypes">,
) => getExternalContext({ ...filters, assetTypes: [assetType] });

export const getExternalHighlightContext = async (
  highlightId: number,
  filters: Omit<ExternalContextFilters, "highlightIds">,
) => getExternalContext({ ...filters, highlightIds: [highlightId] });

export const getExternalDocumentContext = async (
  documentId: number,
  filters: Omit<ExternalContextFilters, "documentIds">,
) => getExternalContext({ ...filters, documentIds: [documentId] });

export const getHighlightsContext = async (
  filters: ExternalContextFilters & PaginationOptions,
): Promise<HighlightsContextResult> => {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset;
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);

  const highlightIdFilter = await buildHighlightIdFilter(filters);
  if (highlightIdFilter && highlightIdFilter.length === 0) {
    return {
      highlights: { items: [] },
      taxonomy: { entities: [], tags: [] },
    };
  }

  const highlightRows = await fetchHighlights({
    filters,
    highlightIdFilter,
    from,
    to,
    limit,
    offset,
  });

  const highlightIds = highlightRows.map((row) => Number(row.id));
  const highlightIdScope = highlightIds.length ? highlightIds : highlightIdFilter;

  const highlightEntities = await fetchHighlightEntities({
    filters,
    highlightIdScope,
  });
  const highlightTags = await fetchHighlightTags({
    filters,
    highlightIdScope,
  });
  const commentRows = await fetchHighlightComments({
    filters,
    highlightIdScope,
    from,
    to,
    limit,
  });

  const entityIds = new Set<number>(
    filters.entityIds ?? highlightEntities.map((row) => Number(row.entityId)),
  );
  const tagIds = new Set<number>(filters.tagIds ?? highlightTags.map((row) => Number(row.tagId)));

  const entityRows = await fetchEntities({ entityIds, limit });
  const tagRows = await fetchTags({
    tagIds,
    filters,
    limit,
  });

  const { highlightItems } = buildHighlightItems({
    highlightRows,
    highlightEntities,
    highlightTags,
    commentRows,
  });

  return {
    highlights: { items: highlightItems },
    taxonomy: { entities: entityRows, tags: tagRows },
  };
};

export const getTrendsContext = async (
  filters: ExternalContextFilters & PaginationOptions,
): Promise<TrendsContextResult> => {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset;
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);

  const highlightIdFilter = await buildHighlightIdFilter(filters);
  if (highlightIdFilter && highlightIdFilter.length === 0) {
    return { trends: { items: [] } };
  }

  const trendRows = await fetchTrends({
    filters,
    highlightIdScope: highlightIdFilter,
    from,
    to,
    limit,
    offset,
  });

  const trendIds = trendRows.map((row) => Number(row.id));
  const trendAssetRows = await fetchTrendAssetsByTrendIds({
    trendIds,
    assetTypes: filters.assetTypes,
    entityIds: filters.entityIds,
    limit,
  });

  return {
    trends: {
      items: buildTrendItems({ trendRows, trendAssetRows }),
    },
  };
};

export const getScenariosContext = async (
  filters: ExternalContextFilters & PaginationOptions,
): Promise<ScenariosContextResult> => {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset;
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);

  const highlightIdFilter = await buildHighlightIdFilter(filters);
  if (highlightIdFilter && highlightIdFilter.length === 0) {
    return { scenarios: { items: [] } };
  }

  const scenarioRows = await fetchScenarios({
    filters,
    highlightIdScope: highlightIdFilter,
    from,
    to,
    limit,
    offset,
  });

  const scenarioIds = scenarioRows.map((row) => Number(row.id));
  const scenarioRemarkRows = await fetchScenarioRemarksByScenarioIds({
    scenarioIds,
    assetTypes: filters.assetTypes,
    entityIds: filters.entityIds,
    limit,
  });

  return {
    scenarios: {
      items: buildScenarioItems({ scenarioRows, scenarioRemarkRows }),
    },
  };
};

export const getCalendarContext = async (
  filters: ExternalContextFilters & PaginationOptions,
): Promise<CalendarContextResult> => {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset;
  const from = normalizeDate(filters.from);
  const to = normalizeDate(filters.to);

  const highlightIdFilter = await buildHighlightIdFilter(filters);
  if (highlightIdFilter && highlightIdFilter.length === 0) {
    return { calendar: { items: [] } };
  }

  const calendarEventRows = await fetchCalendarEvents({
    filters,
    highlightIdScope: highlightIdFilter,
    from,
    to,
    limit,
    offset,
  });
  const calendarEventEntities = await fetchCalendarEventEntities({
    calendarEventRows,
    entityIds: filters.entityIds,
  });

  return {
    calendar: {
      items: buildCalendarItems({
        calendarEventRows,
        calendarEventEntities,
      }),
    },
  };
};

const buildSearchPattern = (query: string) => `%${query.trim()}%`;

export const searchExternalEntities = async ({
  query,
  limit,
}: {
  query: string;
  limit?: number;
}) => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = buildSearchPattern(trimmed);
  return getDb()
    .select(selectEntities)
    .from(entities)
    .where(
      or(
        ilike(entities.name, pattern),
        ilike(entities.uniqueId, pattern),
        ilike(entities.description, pattern),
      ),
    )
    .orderBy(entities.name)
    .limit(clampLimit(limit));
};

export const searchExternalTags = async ({
  query,
  teamId,
  teamIds,
  limit,
}: {
  query: string;
  teamId?: string;
  teamIds?: string[];
  limit?: number;
}) => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = buildSearchPattern(trimmed);
  const teamFilter = teamIds?.length
    ? inArray(tags.teamId, teamIds)
    : teamId
      ? eq(tags.teamId, teamId)
      : undefined;
  return getDb()
    .select(selectTags)
    .from(tags)
    .where(
      and(
        or(ilike(tags.name, pattern), ilike(tags.description, pattern)),
        teamFilter,
      ),
    )
    .orderBy(tags.name)
    .limit(clampLimit(limit));
};

export const searchExternalUsers = async ({
  query,
  limit,
}: {
  query: string;
  limit?: number;
}) => {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const pattern = buildSearchPattern(trimmed);
  return getDb()
    .select(selectAccounts)
    .from(accounts)
    .where(
      or(
        ilike(accounts.name, pattern),
        ilike(accounts.email, pattern),
        ilike(accounts.slug, pattern),
      ),
    )
    .orderBy(accounts.name)
    .limit(clampLimit(limit));
};

const SIMILARITY_THRESHOLD = 0.3;

export const semanticSearchExternalEntities = async ({
  embedding,
  limit,
}: {
  embedding: number[];
  limit?: number;
}) => {
  const similarity = sql<number>`1 - (${cosineDistance(entities.descriptionEmbedding, embedding)})`;
  return getDb()
    .select({
      id: entities.id,
      name: entities.name,
      uniqueId: entities.uniqueId,
      type: entities.type,
      description: entities.description,
      createdAt: entities.createdAt,
      updatedAt: entities.updatedAt,
      similarity,
    })
    .from(entities)
    .where(gte(similarity, SIMILARITY_THRESHOLD))
    .orderBy(desc(similarity))
    .limit(clampLimit(limit));
};
