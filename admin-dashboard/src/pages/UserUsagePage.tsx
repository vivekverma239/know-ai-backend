import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAdminUserUsageDetail } from "../lib/api";
import { localDateToIsoEnd, localDateToIsoStart } from "../lib/dateRange";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";

const formatUSD = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

const formatInt = (n: number) => n.toLocaleString();

const SOURCE_COLORS: Record<string, string> = {
  chat: "#6366f1",
  parse: "#0ea5e9",
  report: "#22c55e",
  tool: "#f59e0b",
  search: "#ef4444",
  embedding: "#a855f7",
  other: "#64748b",
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-lg bg-card p-3 flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="m-0 text-2xl font-semibold leading-tight">{value}</p>
      {sub ? <p className="m-0 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function UserUsagePage() {
  const { userId = "" } = useParams<{ userId: string }>();
  const accessToken = useAuthStore((state) => state.accessToken);

  // Default to current month (MTD).
  const defaultStart = useMemo(() => {
    const d = new Date();
    return format(new Date(d.getFullYear(), d.getMonth(), 1), "yyyy-MM-dd");
  }, []);
  const defaultEnd = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);
  const query = useMemo(
    () => ({
      startDate: localDateToIsoStart(startDate),
      endDate: localDateToIsoEnd(endDate),
      orgId: selectedOrgId || undefined,
    }),
    [startDate, endDate, selectedOrgId],
  );

  const usageQuery = useQuery({
    queryKey: ["admin-user-usage", accessToken, userId, query],
    queryFn: () => getAdminUserUsageDetail(accessToken ?? "", userId, query),
    enabled: Boolean(accessToken && userId),
  });

  const data = usageQuery.data;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="m-0 text-xs text-muted-foreground">
            <Link to="/dashboard/usage" className="hover:underline">
              ← All usage
            </Link>
          </p>
          <h2 className="m-0 text-lg font-semibold">User usage</h2>
          <p className="m-0 text-xs font-mono text-muted-foreground break-all">{userId}</p>
        </div>
        {data ? (
          <p className="m-0 text-xs text-muted-foreground">
            {format(new Date(data.windowStart), "MMM d, yyyy")} –{" "}
            {format(new Date(data.windowEnd), "MMM d, yyyy")}
          </p>
        ) : null}
      </div>

      {/* Date range */}
      <div className="grid grid-cols-1 md:grid-cols-[160px_160px_auto] gap-x-3 gap-y-2 items-end">
        <div className="space-y-1">
          <Label htmlFor="start" className="text-xs text-muted-foreground">Start date</Label>
          <Input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="end" className="text-xs text-muted-foreground">End date</Label>
          <Input
            id="end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStartDate(defaultStart);
              setEndDate(defaultEnd);
            }}
          >
            MTD
          </Button>
        </div>
      </div>

      {usageQuery.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : null}
      {usageQuery.isError ? (
        <p className="text-destructive text-xs">Failed to load user usage data.</p>
      ) : null}

      {data ? (
        <>
          {/* Totals cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatCard
              label="Total cost"
              value={formatUSD(data.totals.totalCost)}
              sub={`${formatInt(data.totals.requestCount)} requests`}
            />
            <StatCard label="Total tokens" value={formatInt(data.totals.totalTokens)} />
            <StatCard label="Distinct models" value={formatInt(data.byModel.length)} />
          </div>

          {/* By source pie + by day bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="border border-border rounded-lg bg-card p-3">
              <p className="m-0 mb-2 text-sm font-semibold">Cost by source</p>
              {data.bySource.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data in this window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={data.bySource}
                      dataKey="totalCost"
                      nameKey="source"
                      outerRadius={90}
                      label={(props) => String(props.name ?? "")}
                    >
                      {data.bySource.map((entry) => (
                        <Cell
                          key={entry.source}
                          fill={SOURCE_COLORS[entry.source] ?? "#64748b"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => {
                        const n = typeof value === "number" ? value : Number(value);
                        return [formatUSD(n), String(name)];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="border border-border rounded-lg bg-card p-3">
              <p className="m-0 mb-2 text-sm font-semibold">Daily cost</p>
              {data.byDay.length === 0 ? (
                <p className="text-xs text-muted-foreground">No data in this window.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={data.byDay}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
                    <Tooltip
                      formatter={(value) => {
                        const n = typeof value === "number" ? value : Number(value);
                        return [formatUSD(n), "Cost"];
                      }}
                    />
                    <Bar dataKey="totalCost" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* By source table */}
          <div className="border border-border rounded-lg bg-card p-3">
            <p className="m-0 mb-2 text-sm font-semibold">By source</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.bySource.map((s) => (
                  <TableRow key={s.source}>
                    <TableCell>
                      <span
                        className="inline-block size-2 rounded-full mr-2 align-middle"
                        style={{ backgroundColor: SOURCE_COLORS[s.source] ?? "#64748b" }}
                      />
                      {s.source}
                    </TableCell>
                    <TableCell className="text-right">{formatInt(s.totalTokens)}</TableCell>
                    <TableCell className="text-right">{formatUSD(s.totalCost)}</TableCell>
                    <TableCell className="text-right">{formatInt(s.requestCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* By model table */}
          <div className="border border-border rounded-lg bg-card p-3">
            <p className="m-0 mb-2 text-sm font-semibold">By model</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byModel.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="font-mono text-xs max-w-[320px] truncate">
                      {m.model}
                    </TableCell>
                    <TableCell className="text-right">{formatInt(m.totalTokens)}</TableCell>
                    <TableCell className="text-right">{formatUSD(m.totalCost)}</TableCell>
                    <TableCell className="text-right">{formatInt(m.requestCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </section>
  );
}
