import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  COST_SOURCES,
  type CostSource,
  type UsageFilters,
  getAdminUsageByDay,
  getAdminUsageByOperation,
  getAdminUsageByUser,
  getAdminUsageSummary,
} from "../lib/api";
import { localDateToIsoEnd, localDateToIsoStart } from "../lib/dateRange";
import { useAuthStore } from "../store/authStore";
import { useOrgStore } from "../store/orgStore";

type SourceFilterValue = CostSource | "all";

const SOURCE_OPTIONS: SourceFilterValue[] = ["all", ...COST_SOURCES];

const formatUSD = (n: number) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

const formatInt = (n: number) => n.toLocaleString();

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-border rounded-lg bg-card p-3 flex flex-col gap-1">
      <p className="m-0 text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="m-0 text-2xl font-semibold leading-tight">{value}</p>
      {sub ? <p className="m-0 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function UsagePage() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const selectedOrgId = useOrgStore((state) => state.selectedOrgId);

  const defaultEnd = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const defaultStart = useMemo(() => format(subDays(new Date(), 30), "yyyy-MM-dd"), []);

  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [source, setSource] = useState<SourceFilterValue>("all");

  const filters = useMemo<UsageFilters>(
    () => ({
      startDate: localDateToIsoStart(startDate),
      endDate: localDateToIsoEnd(endDate),
      orgId: selectedOrgId || undefined,
      source: source === "all" ? undefined : source,
    }),
    [startDate, endDate, selectedOrgId, source],
  );

  const enabled = Boolean(accessToken);
  const summaryQuery = useQuery({
    queryKey: ["admin-usage-summary", accessToken, filters],
    queryFn: () => getAdminUsageSummary(accessToken ?? "", filters),
    enabled,
  });
  const byDayQuery = useQuery({
    queryKey: ["admin-usage-by-day", accessToken, filters],
    queryFn: () => getAdminUsageByDay(accessToken ?? "", filters),
    enabled,
  });
  const LIMIT = 25;
  const byUserQuery = useQuery({
    queryKey: ["admin-usage-by-user", accessToken, filters, LIMIT],
    queryFn: () => getAdminUsageByUser(accessToken ?? "", { ...filters, limit: LIMIT }),
    enabled,
  });
  const byOperationQuery = useQuery({
    queryKey: ["admin-usage-by-operation", accessToken, filters, LIMIT],
    queryFn: () => getAdminUsageByOperation(accessToken ?? "", { ...filters, limit: LIMIT }),
    enabled,
  });

  const totals = summaryQuery.data?.totals;
  const distinctModels = summaryQuery.data?.summary.length ?? 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="m-0 text-lg font-semibold">Usage & Cost</h2>
        <p className="m-0 text-xs text-muted-foreground">
          Aggregated token usage from <code>token_usage_log</code>. Costs are estimates from
          tokenlens (LLM) or hardcoded rates (search / scrape).
        </p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-[160px_160px_180px_auto] gap-x-3 gap-y-2 items-end">
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
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Source</Label>
          <Select
            value={source}
            onValueChange={(v) => setSource(v as SourceFilterValue)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStartDate(format(subDays(new Date(), 7), "yyyy-MM-dd"));
              setEndDate(defaultEnd);
            }}
          >
            7d
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStartDate(format(subDays(new Date(), 30), "yyyy-MM-dd"));
              setEndDate(defaultEnd);
            }}
          >
            30d
          </Button>
        </div>
      </div>

      {/* Totals cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total cost"
          value={totals ? formatUSD(totals.totalCost) : "—"}
          sub={totals ? `${formatInt(totals.requestCount)} requests` : undefined}
        />
        <StatCard
          label="Total tokens"
          value={totals ? formatInt(totals.totalTokens) : "—"}
        />
        <StatCard
          label="Distinct models"
          value={summaryQuery.data ? formatInt(distinctModels) : "—"}
        />
        <StatCard
          label="Top users"
          value={byUserQuery.data ? formatInt(byUserQuery.data.users.length) : "—"}
          sub="in window"
        />
      </div>

      {/* Time series */}
      <div className="border border-border rounded-lg bg-card p-3">
        <p className="m-0 mb-2 text-sm font-semibold">Daily cost</p>
        {byDayQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : !byDayQuery.data?.days.length ? (
          <p className="text-xs text-muted-foreground">No data in this window.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={byDayQuery.data.days}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(2)}`} />
              <Tooltip
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : Number(value);
                  if (name === "totalCost") return [formatUSD(n), "Cost"];
                  return [formatInt(n), String(name)];
                }}
              />
              <Line
                type="monotone"
                dataKey="totalCost"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By user / By model side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="border border-border rounded-lg bg-card p-3">
          <p className="m-0 mb-2 text-sm font-semibold">Top users (by tokens)</p>
          {byUserQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(byUserQuery.data?.users ?? []).map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell className="font-mono text-xs max-w-[260px] truncate">
                      <Link
                        to={`/dashboard/usage/users/${encodeURIComponent(u.userId)}`}
                        className="hover:underline"
                      >
                        {u.userId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{formatInt(u.totalTokens)}</TableCell>
                    <TableCell className="text-right">{formatUSD(u.totalCost)}</TableCell>
                    <TableCell className="text-right">{formatInt(u.requestCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <div className="border border-border rounded-lg bg-card p-3">
          <p className="m-0 mb-2 text-sm font-semibold">By model</p>
          {summaryQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
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
                {(summaryQuery.data?.summary ?? []).map((m) => (
                  <TableRow key={m.model}>
                    <TableCell className="font-mono text-xs max-w-[260px] truncate">
                      {m.model}
                    </TableCell>
                    <TableCell className="text-right">{formatInt(m.totalTokens)}</TableCell>
                    <TableCell className="text-right">{formatUSD(m.totalCost)}</TableCell>
                    <TableCell className="text-right">{formatInt(m.requestCount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* By operation */}
      <div className="border border-border rounded-lg bg-card p-3">
        <p className="m-0 mb-2 text-sm font-semibold">By operation</p>
        {byOperationQuery.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operation</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Avg tokens / call</TableHead>
                <TableHead className="text-right">Total tokens</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(byOperationQuery.data?.operations ?? []).map((op) => (
                <TableRow key={op.operationName}>
                  <TableCell className="font-mono text-xs max-w-[320px] truncate">
                    {op.operationName}
                  </TableCell>
                  <TableCell className="text-right">{formatInt(op.callCount)}</TableCell>
                  <TableCell className="text-right">{formatInt(op.avgTokensPerCall)}</TableCell>
                  <TableCell className="text-right">{formatInt(op.totalTokens)}</TableCell>
                  <TableCell className="text-right">{formatUSD(op.totalCost)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {(summaryQuery.isError ||
        byDayQuery.isError ||
        byUserQuery.isError ||
        byOperationQuery.isError) && (
        <p className="text-destructive text-xs">
          Failed to load usage data. Check that you're authenticated as admin and the backend is
          running.
        </p>
      )}
    </section>
  );
}
