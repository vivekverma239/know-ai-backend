import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  API_BASE_URL,
  createPlaygroundReport,
  getPlaygroundMembers,
  getPlaygroundReport,
  getPlaygroundReports,
  getPlaygroundTemplates,
} from "@/lib/api";
import type {
  PlaygroundMember,
  PlaygroundReportSummary,
} from "@/lib/types";
import { useAuthStore } from "@/store/authStore";
import { useOrgStore } from "@/store/orgStore";

function MemberLabel(member: PlaygroundMember) {
  const teamNames = member.teams
    ?.map((t) => t.name)
    .filter(Boolean)
    .join(", ");
  const shortId = `${member.id.slice(0, 4)}...${member.id.slice(-4)}`;
  const base = member.name ? `${member.name} (${shortId})` : shortId;
  return teamNames ? `${base} - ${teamNames}` : base;
}

function getTextFromParts(parts: { type: string; text?: string }[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text)
    .join("");
}

function createSessionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type ChatToolPart = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  name?: string;
  state?: string;
  output?: unknown;
};

function getToolDisplayName(part: ChatToolPart): string {
  if (part.toolName) return part.toolName;
  if (part.name) return part.name;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  if (part.type === "dynamic-tool") return "dynamic-tool";
  return "unknown";
}

// ─── Chat Tab ────────────────────────────────────────────────────────────────

type ChatMode = "finAgent" | "knowledgeBase" | "agentSearch";

const CHAT_MODE_LABEL: Record<ChatMode, string> = {
  finAgent: "FinAgent (admin playground)",
  knowledgeBase: "Knowledge Base (/api/v1/chat)",
  agentSearch: "Deep Search (/api/v1/chat)",
};

function ChatTab({ selectedMember, orgId }: { selectedMember: PlaygroundMember; orgId: string }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [sessionId, setSessionId] = useState(() => createSessionId());
  const [mode, setMode] = useState<ChatMode>("finAgent");

  const transport = useMemo(() => {
    if (mode === "finAgent") {
      return new DefaultChatTransport({
        api: `${API_BASE_URL}/admin/playground/chat`,
        headers: { Authorization: `Bearer ${accessToken}` },
        body: { userId: selectedMember.id, orgId, sessionId },
      });
    }
    return new DefaultChatTransport({
      api: `${API_BASE_URL}/admin/playground/chat-stream`,
      headers: { Authorization: `Bearer ${accessToken}` },
      body: {
        userId: selectedMember.id,
        orgId,
        sessionId,
        deepSearch: mode === "agentSearch" ? "agentSearch" : "knowledgeBase",
      },
    });
  }, [accessToken, selectedMember.id, orgId, sessionId, mode]);

  const { messages, sendMessage, status, setMessages } = useChat({ transport });

  const isActive = status === "streaming" || status === "submitted";

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset chat when user, org, or mode changes
  useEffect(() => {
    setSessionId(createSessionId());
    setMessages([]);
  }, [selectedMember.id, orgId, mode, setMessages]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isActive) return;
    setInputValue("");
    sendMessage({ text });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-220px)]">
      {/* Mode selector */}
      <div className="flex items-center gap-2 px-2 pb-2 border-b border-border">
        <span className="text-xs text-muted-foreground">Mode:</span>
        <Select value={mode} onValueChange={(v) => setMode(v as ChatMode)} disabled={isActive}>
          <SelectTrigger className="h-8 w-[280px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHAT_MODE_LABEL) as ChatMode[]).map((m) => (
              <SelectItem key={m} value={m}>
                {CHAT_MODE_LABEL[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground ml-2">
          Switching mode resets the session.
        </span>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-3 p-2">
        {messages.length === 0 && (
          <p className="text-muted-foreground text-sm text-center mt-8">
            Send a message to start chatting as {MemberLabel(selectedMember)} in{" "}
            <span className="font-medium">{CHAT_MODE_LABEL[mode]}</span> mode
          </p>
        )}
        {messages.map((msg) => {
          const textContent = getTextFromParts(msg.parts as { type: string; text?: string }[]);
          const toolParts = msg.parts.filter(
            (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool",
          );

          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                {msg.role === "assistant" && textContent ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {textContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="m-0 whitespace-pre-wrap">{textContent}</p>
                )}
                {/* Tool invocations */}
                {toolParts.map((part, i) => {
                  const toolPart = part as ChatToolPart;
                  return (
                    <details key={i} className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Tool: {getToolDisplayName(toolPart)}
                        {" "}
                        <Badge variant="secondary" className="text-[10px]">
                          {toolPart.state ?? toolPart.type}
                        </Badge>
                      </summary>
                      {toolPart.output != null && (
                        <pre className="mt-1 overflow-x-auto bg-background/50 rounded p-1.5 text-[11px]">
                          {JSON.stringify(toolPart.output, null, 2)?.slice(0, 500)}
                        </pre>
                      )}
                    </details>
                  );
                })}
              </div>
            </div>
          );
        })}
        {isActive && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground animate-pulse">
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="flex gap-2 p-2 border-t border-border">
        <Textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 min-h-[40px] max-h-[120px] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button onClick={handleSend} disabled={isActive || !inputValue.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}

// ─── Reports Tab ─────────────────────────────────────────────────────────────

function ReportsTab({
  selectedMember,
}: {
  selectedMember: PlaygroundMember;
}) {
  const accessToken = useAuthStore((s) => s.accessToken) ?? "";
  const queryClient = useQueryClient();

  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [topic, setTopic] = useState("");
  const [referencePeriod, setReferencePeriod] = useState("");
  const [expandedReportId, setExpandedReportId] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["playground-templates"],
    queryFn: () => getPlaygroundTemplates(accessToken),
    enabled: Boolean(accessToken),
  });

  const reportsQuery = useQuery({
    queryKey: ["playground-reports", selectedMember.id],
    queryFn: () => getPlaygroundReports(accessToken, selectedMember.id),
    enabled: Boolean(accessToken),
    refetchInterval: (query) => {
      const reports = query.state.data?.items;
      if (!reports) return false;
      const hasInProgress = reports.some(
        (r) => r.status === "pending" || r.status === "in_progress",
      );
      return hasInProgress ? 5000 : false;
    },
  });

  const createReportMutation = useMutation({
    mutationFn: () =>
      createPlaygroundReport(accessToken, {
        userId: selectedMember.id,
        templateId: selectedTemplateId,
        topic,
        referencePeriod: referencePeriod || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["playground-reports", selectedMember.id] });
      setTopic("");
      setReferencePeriod("");
    },
  });

  return (
    <div className="space-y-4">
      {/* Create report form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Create Report</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Template</label>
              <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {templatesQuery.data?.items.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Reference Period</label>
              <Input
                value={referencePeriod}
                onChange={(e) => setReferencePeriod(e.target.value)}
                placeholder="e.g. Q4 2025"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Topic</label>
            <Input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Market analysis for AAPL"
            />
          </div>
          <Button
            onClick={() => createReportMutation.mutate()}
            disabled={
              !selectedTemplateId || !topic.trim() || createReportMutation.isPending
            }
            size="sm"
          >
            {createReportMutation.isPending ? "Creating..." : "Create Report"}
          </Button>
        </CardContent>
      </Card>

      {/* Reports list */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Reports</CardTitle>
        </CardHeader>
        <CardContent>
          {reportsQuery.isLoading && (
            <p className="text-muted-foreground text-sm">Loading reports...</p>
          )}
          {reportsQuery.data?.items.length === 0 && (
            <p className="text-muted-foreground text-sm">No reports found for this user.</p>
          )}
          <div className="space-y-2">
            {reportsQuery.data?.items.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                isExpanded={expandedReportId === report.id}
                onToggle={() =>
                  setExpandedReportId(expandedReportId === report.id ? null : report.id)
                }
                accessToken={accessToken}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  in_progress: "outline",
  completed: "default",
  failed: "destructive",
};

function ReportRow({
  report,
  isExpanded,
  onToggle,
  accessToken,
}: {
  report: PlaygroundReportSummary;
  isExpanded: boolean;
  onToggle: () => void;
  accessToken: string;
}) {
  const detailQuery = useQuery({
    queryKey: ["playground-report-detail", report.id],
    queryFn: () => getPlaygroundReport(accessToken, report.id),
    enabled: isExpanded,
  });

  return (
    <div className="border border-border rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted/50 rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={STATUS_VARIANT[report.status] ?? "secondary"}>
            {report.status}
          </Badge>
          <span className="truncate font-medium">{report.topic}</span>
          {report.templateName && (
            <span className="text-muted-foreground text-xs truncate">
              ({report.templateName})
            </span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 border-t border-border">
          {detailQuery.isLoading && (
            <p className="text-muted-foreground text-sm mt-2">Loading report details...</p>
          )}
          {detailQuery.data?.finalOutput && (
            <div className="mt-2 prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {detailQuery.data.finalOutput}
              </ReactMarkdown>
            </div>
          )}
          {detailQuery.data && !detailQuery.data.finalOutput && (
            <p className="text-muted-foreground text-sm mt-2">
              {report.status === "pending" || report.status === "in_progress"
                ? "Report is still being generated..."
                : "No output available."}
            </p>
          )}
          {detailQuery.data?.sources && detailQuery.data.sources.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-muted-foreground mb-1">Sources:</p>
              <ul className="text-xs space-y-0.5">
                {detailQuery.data.sources.map((source, i) => (
                  <li key={i}>
                    {source.url ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {source.title || source.url}
                      </a>
                    ) : (
                      <span>{source.title || "Untitled source"}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function PlaygroundPage() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const selectedOrgId = useOrgStore((s) => s.selectedOrgId);

  const selectedMemberId = useOrgStore((s) => s.selectedMemberId);
  const setSelectedMemberId = useOrgStore((s) => s.setSelectedMemberId);

  const membersQuery = useQuery({
    queryKey: ["playground-members", selectedOrgId],
    queryFn: () => getPlaygroundMembers(accessToken ?? "", selectedOrgId),
    enabled: Boolean(accessToken) && Boolean(selectedOrgId),
  });

  const selectedMember = membersQuery.data?.items.find((m) => m.id === selectedMemberId);

  const memberLabelMap = new Map(
    membersQuery.data?.items.map((m) => [m.id, MemberLabel(m)]) ?? [],
  );
  const memberValueToLabel = useCallback(
    (value: string) => memberLabelMap.get(value) ?? value,
    [memberLabelMap],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Playground</h2>
        <div className="w-72">
          <Combobox
            value={selectedMemberId}
            onValueChange={(val) => setSelectedMemberId(val ?? "")}
            itemToStringLabel={memberValueToLabel}
          >
            <ComboboxInput
              placeholder={membersQuery.isLoading ? "Loading members..." : "Select a user..."}
              disabled={membersQuery.isLoading || !membersQuery.data?.items.length}
              className="w-full"
            />
            <ComboboxContent>
              <ComboboxList>
                <ComboboxEmpty>No members found.</ComboboxEmpty>
                {membersQuery.data?.items.map((member) => (
                  <ComboboxItem key={member.id} value={member.id}>
                    <span className="truncate">{MemberLabel(member)}</span>
                  </ComboboxItem>
                ))}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      </div>

      {!selectedMember ? (
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Select a user to impersonate.</p>
        </div>
      ) : (
        <Tabs defaultValue="chat">
          <TabsList>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="chat">
            <ChatTab selectedMember={selectedMember} orgId={selectedOrgId} />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsTab selectedMember={selectedMember} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
