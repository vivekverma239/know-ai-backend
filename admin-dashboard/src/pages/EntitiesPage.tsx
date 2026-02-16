import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminEntities, getAdminEntityDetail } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";

export function EntitiesPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [highlightsPage, setHighlightsPage] = useState(1);

  const entitiesQueryInput = useMemo(
    () => ({ orgId: selectedOrgId, q: search, page, pageSize: 25 }),
    [selectedOrgId, search, page],
  );

  const entitiesQuery = useQuery({
    queryKey: ["admin-entities", accessToken, entitiesQueryInput],
    queryFn: () =>
      getAdminEntities(accessToken ?? "", {
        orgId: selectedOrgId,
        q: search,
        page,
        pageSize: 25,
      }),
    enabled: Boolean(accessToken && selectedOrgId),
  });

  const effectiveSelectedEntityId = useMemo(() => {
    const items = entitiesQuery.data?.items ?? [];
    if (items.length === 0) return null;
    const selectedExists = items.some((entity) => entity.id === selectedEntityId);
    if (selectedExists) return selectedEntityId;
    return items[0]?.id ?? null;
  }, [entitiesQuery.data?.items, selectedEntityId]);

  const entityDetailQuery = useQuery({
    queryKey: [
      "admin-entity-detail",
      accessToken,
      selectedOrgId,
      effectiveSelectedEntityId,
      highlightsPage,
    ],
    queryFn: () =>
      getAdminEntityDetail(accessToken ?? "", effectiveSelectedEntityId ?? 0, {
        orgId: selectedOrgId,
        highlightsPage,
        highlightsPageSize: 10,
      }),
    enabled: Boolean(accessToken && selectedOrgId && effectiveSelectedEntityId),
  });

  if (!selectedOrgId) {
    return (
      <section>
        <div className="section-head">
          <div>
            <p className="eyebrow">Entity Lens</p>
            <h2>Entities</h2>
          </div>
        </div>
        <p className="state-text">Select an org scope from the top bar to inspect entities.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">Entity Lens</p>
          <h2>Entities</h2>
        </div>
      </div>

      <div className="filters-grid single">
        <label htmlFor="entity-search">Search entities</label>
        <input
          id="entity-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Name, ticker, description"
        />
      </div>

      <div className="entities-grid">
        <article className="card list-card">
          <h3>Entity List</h3>
          {entitiesQuery.isLoading ? <p className="state-text">Loading entities...</p> : null}
          {entitiesQuery.isError ? (
            <p className="state-text error">Could not fetch entities for this org.</p>
          ) : null}

          {entitiesQuery.data ? (
            <>
              <ul className="entity-list">
                {entitiesQuery.data.items.map((entity) => (
                  <li key={entity.id}>
                    <button
                      type="button"
                      className={effectiveSelectedEntityId === entity.id ? "active" : ""}
                      onClick={() => {
                        setSelectedEntityId(entity.id);
                        setHighlightsPage(1);
                      }}
                    >
                      <span>{entity.name}</span>
                      <small>
                        {entity.highlightCount} highlights | {entity.documentCount} docs
                      </small>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="pagination-row">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  Previous
                </button>
                <span>Page {page}</span>
                <button
                  type="button"
                  disabled={entitiesQuery.data.items.length < 25}
                  onClick={() => setPage((value) => value + 1)}
                >
                  Next
                </button>
              </div>
            </>
          ) : null}
        </article>

        <article className="card detail-card">
          <h3>Entity Detail</h3>
          {entityDetailQuery.isLoading ? <p className="state-text">Loading entity context...</p> : null}
          {entityDetailQuery.isError ? (
            <p className="state-text error">Failed to load entity detail.</p>
          ) : null}

          {entityDetailQuery.data ? (
            <>
              <div className="entity-header">
                <h4>{entityDetailQuery.data.entity.name}</h4>
                <p>{entityDetailQuery.data.entity.description ?? "No description available."}</p>
              </div>

              <div className="subpanel">
                <h5>Related Documents</h5>
                {entityDetailQuery.data.relatedDocuments.length === 0 ? (
                  <p>No related documents linked yet.</p>
                ) : (
                  <ul className="document-list">
                    {entityDetailQuery.data.relatedDocuments.map((doc) => (
                      <li key={doc.id}>
                        <div>
                          <strong>{doc.title ?? `Document ${doc.id}`}</strong>
                          <span>{doc.type ?? "unknown"}</span>
                        </div>
                        <div className="doc-links">
                          {doc.linkedUserFileId ? (
                            <Link to={`/dashboard/documents/${doc.linkedUserFileId}`}>Open parsed doc</Link>
                          ) : null}
                          {doc.documentUrl ? (
                            <a href={doc.documentUrl} target="_blank" rel="noreferrer">
                              Source
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="subpanel">
                <h5>Highlights</h5>
                {entityDetailQuery.data.highlights.items.length === 0 ? (
                  <p>No highlights found for this entity in the selected org.</p>
                ) : (
                  <ul className="highlight-list">
                    {entityDetailQuery.data.highlights.items.map((highlight) => (
                      <li key={highlight.id}>
                        <p>{highlight.aiSummary || highlight.content || "No textual content"}</p>
                        <small>{new Date(highlight.createdAt).toLocaleString()}</small>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="pagination-row">
                  <button
                    type="button"
                    disabled={highlightsPage <= 1}
                    onClick={() => setHighlightsPage((value) => Math.max(1, value - 1))}
                  >
                    Previous
                  </button>
                  <span>Highlights page {highlightsPage}</span>
                  <button
                    type="button"
                    disabled={entityDetailQuery.data.highlights.items.length < 10}
                    onClick={() => setHighlightsPage((value) => value + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </article>
      </div>
    </section>
  );
}
