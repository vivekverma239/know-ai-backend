import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminDocuments } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";

const STATUS_OPTIONS = ["all", "pending", "in_progress", "completed", "failed"];
const TYPE_OPTIONS = ["all", "pdf", "web_article", "structured_report"];

export function DocumentsPage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [page, setPage] = useState(1);

  const query = useMemo(
    () => ({
      orgId: selectedOrgId || undefined,
      search,
      status,
      type,
      page,
      pageSize: 25,
    }),
    [selectedOrgId, search, status, type, page],
  );

  const documentsQuery = useQuery({
    queryKey: ["admin-documents", accessToken, query],
    queryFn: () => getAdminDocuments(accessToken ?? "", query),
    enabled: Boolean(accessToken),
  });

  const totalPages = Math.max(1, Math.ceil((documentsQuery.data?.total ?? 0) / 25));

  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">Inspection</p>
          <h2>Documents</h2>
        </div>
      </div>

      <div className="filters-grid">
        <label htmlFor="search">Search</label>
        <input
          id="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="File name or source URL"
        />

        <label htmlFor="status">Status</label>
        <select
          id="status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <label htmlFor="type">Type</label>
        <select
          id="type"
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
        >
          {TYPE_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {documentsQuery.isLoading ? <p className="state-text">Loading documents...</p> : null}
      {documentsQuery.isError ? (
        <p className="state-text error">Failed to load documents. Try refreshing.</p>
      ) : null}

      {documentsQuery.data ? (
        <>
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Org</th>
                  <th>Status</th>
                  <th>Type</th>
                  <th>Pages</th>
                  <th>Sections</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documentsQuery.data.items.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.name}</td>
                    <td>{doc.orgId}</td>
                    <td>
                      <span className={`status-pill ${doc.status}`}>{doc.status}</span>
                    </td>
                    <td>{doc.type}</td>
                    <td>{doc.numPages}</td>
                    <td>{doc.numSections}</td>
                    <td>{new Date(doc.updatedAt ?? doc.createdAt).toLocaleString()}</td>
                    <td>
                      <Link className="action-link" to={`/dashboard/documents/${doc.id}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination-row">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
