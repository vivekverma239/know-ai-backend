import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getAdminDocuments, getAdminOrgs } from "../lib/api";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_OPTIONS = ["all", "pending", "in_progress", "completed", "failed"];
const TYPE_OPTIONS = ["all", "pdf", "web_article", "structured_report"];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  return "secondary";
}

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

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs", accessToken],
    queryFn: () => getAdminOrgs(accessToken ?? ""),
    enabled: Boolean(accessToken),
  });

  const orgMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of orgsQuery.data?.items ?? []) {
      if (org.name) map.set(org.orgId, org.name);
      else map.set(org.orgId, `Org (${org.orgId.slice(0, 4)}...${org.orgId.slice(-4)})`);
    }
    return map;
  }, [orgsQuery.data]);

  const totalPages = Math.max(1, Math.ceil((documentsQuery.data?.total ?? 0) / 25));

  return (
    <section>
      <div className="mb-3">
        <h2 className="m-0 text-lg font-semibold">Documents</h2>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_130px_170px] gap-x-3 gap-y-2 items-end mb-3">
        <div className="space-y-1">
          <Label htmlFor="search" className="text-xs text-muted-foreground">Search</Label>
          <Input
            id="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="File name or source URL"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {documentsQuery.isLoading ? <p className="text-muted-foreground text-sm">Loading documents...</p> : null}
      {documentsQuery.isError ? (
        <p className="text-destructive text-sm">Failed to load documents. Try refreshing.</p>
      ) : null}

      {documentsQuery.data ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Org</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Pages</TableHead>
                <TableHead>Sections</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {documentsQuery.data.items.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium max-w-[300px] truncate">{doc.name}</TableCell>
                  <TableCell>{orgMap.get(doc.orgId) ?? doc.orgId}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
                  </TableCell>
                  <TableCell>{doc.type}</TableCell>
                  <TableCell>{doc.numPages}</TableCell>
                  <TableCell>{doc.numSections}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(doc.updatedAt ?? doc.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Link to={`/dashboard/documents/${doc.id}`}>
                      <Button variant="link" size="sm">Open</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-3 flex justify-between items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((v) => v - 1)}>
              Previous
            </Button>
            <span className="text-muted-foreground text-sm">
              Page {page} of {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((v) => v + 1)}>
              Next
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
