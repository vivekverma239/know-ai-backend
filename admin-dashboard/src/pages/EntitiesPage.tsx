import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminEntities, getAdminEntityDetail } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export function EntitiesPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [highlightsPage, setHighlightsPage] = useState(1);

  const entitiesQuery = useQuery({
    queryKey: ["admin-entities", accessToken, { orgId: selectedOrgId, q: search, page, pageSize: 25 }],
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

  return (
    <section>
      <div className="mb-4">
        <p className="m-0 uppercase tracking-[0.14em] text-primary text-xs font-bold">Entity Lens</p>
        <h2 className="m-0 mt-1 font-heading text-3xl tracking-wide">Entities</h2>
      </div>

      <div className="max-w-md mb-4 space-y-1">
        <label className="text-xs uppercase tracking-[0.08em] text-muted-foreground" htmlFor="entity-search">
          Search entities
        </label>
        <Input
          id="entity-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Name, ticker, description"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Entity list */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Entity List</CardTitle>
          </CardHeader>
          <CardContent>
            {entitiesQuery.isLoading ? <p className="text-muted-foreground text-sm">Loading entities...</p> : null}
            {entitiesQuery.isError ? (
              <p className="text-destructive text-sm">Could not fetch entities for this org.</p>
            ) : null}

            {entitiesQuery.data ? (
              <>
                <ul className="list-none m-0 p-0 space-y-1">
                  {entitiesQuery.data.items.map((entity) => (
                    <li key={entity.id}>
                      <Button
                        variant={effectiveSelectedEntityId === entity.id ? "default" : "ghost"}
                        className="w-full justify-between text-left h-auto py-2"
                        onClick={() => {
                          setSelectedEntityId(entity.id);
                          setHighlightsPage(1);
                        }}
                      >
                        <span className="truncate">{entity.name}</span>
                        <span className="text-xs opacity-85 shrink-0">
                          {entity.highlightCount} highlights | {entity.documentCount} docs
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex justify-between items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((v) => Math.max(1, v - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-muted-foreground text-sm">Page {page}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={entitiesQuery.data.items.length < 25}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    Next
                  </Button>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* Entity detail */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Entity Detail</CardTitle>
          </CardHeader>
          <CardContent>
            {entityDetailQuery.isLoading ? (
              <p className="text-muted-foreground text-sm">Loading entity context...</p>
            ) : null}
            {entityDetailQuery.isError ? (
              <p className="text-destructive text-sm">Failed to load entity detail.</p>
            ) : null}

            {entityDetailQuery.data ? (
              <>
                <div>
                  <h4 className="m-0 text-base font-bold">{entityDetailQuery.data.entity.name}</h4>
                  <p className="m-0 mt-1 text-sm text-muted-foreground">
                    {entityDetailQuery.data.entity.description ?? "No description available."}
                  </p>
                </div>

                <Separator className="my-4" />

                {/* Related Documents */}
                <div>
                  <h5 className="m-0 text-sm font-bold mb-2">Related Documents</h5>
                  {entityDetailQuery.data.relatedDocuments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No related documents linked yet.</p>
                  ) : (
                    <ul className="list-none p-0 m-0 space-y-2">
                      {entityDetailQuery.data.relatedDocuments.map((doc) => (
                        <li key={doc.id} className="rounded-lg border border-border bg-muted/30 p-3">
                          <div>
                            <strong className="block text-sm">{doc.title ?? `Document ${doc.id}`}</strong>
                            <span className="text-xs text-muted-foreground">{doc.type ?? "unknown"}</span>
                          </div>
                          <div className="flex gap-3 mt-1 text-sm">
                            {doc.linkedUserFileId ? (
                              <Link to={`/dashboard/documents/${doc.linkedUserFileId}`} className="text-primary underline">
                                Open parsed doc
                              </Link>
                            ) : null}
                            {doc.documentUrl ? (
                              <a href={doc.documentUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                                Source
                              </a>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Separator className="my-4" />

                {/* Highlights */}
                <div>
                  <h5 className="m-0 text-sm font-bold mb-2">Highlights</h5>
                  {entityDetailQuery.data.highlights.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No highlights found for this entity in the selected org.
                    </p>
                  ) : (
                    <ul className="list-none p-0 m-0 space-y-2">
                      {entityDetailQuery.data.highlights.items.map((highlight) => (
                        <li key={highlight.id} className="rounded-lg border border-border bg-muted/30 p-3">
                          <p className="m-0 text-sm">
                            {highlight.aiSummary || highlight.content || "No textual content"}
                          </p>
                          <small className="text-xs text-muted-foreground">
                            {new Date(highlight.createdAt).toLocaleString()}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-3 flex justify-between items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={highlightsPage <= 1}
                      onClick={() => setHighlightsPage((v) => Math.max(1, v - 1))}
                    >
                      Previous
                    </Button>
                    <span className="text-muted-foreground text-sm">Highlights page {highlightsPage}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={entityDetailQuery.data.highlights.items.length < 10}
                      onClick={() => setHighlightsPage((v) => v + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
