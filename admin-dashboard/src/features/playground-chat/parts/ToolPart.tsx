import {
  ActivityIcon,
  BookOpenIcon,
  CheckCircle2Icon,
  CheckSquareIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileSearchIcon,
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  SearchIcon,
  UsersIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export type ChatToolPart = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  name?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

type ToolDisplay = {
  running: string;
  done: string;
  icon: ReactNode;
};

const TOOL_DISPLAY: Record<string, ToolDisplay> = {
  teamContextTool: {
    running: "Loading user context",
    done: "Loaded user context",
    icon: <UsersIcon className="size-3.5" />,
  },
  getTodoListTool: {
    running: "Reviewing tasks",
    done: "Reviewed tasks",
    icon: <CheckSquareIcon className="size-3.5" />,
  },
  updateTodoListTool: {
    running: "Updating tasks",
    done: "Updated tasks",
    icon: <CheckSquareIcon className="size-3.5" />,
  },
  fileSearchAgent: {
    running: "Searching documents",
    done: "Searched documents",
    icon: <FileSearchIcon className="size-3.5" />,
  },
  chunkSearchTool: {
    running: "Reading passages",
    done: "Read passages",
    icon: <SearchIcon className="size-3.5" />,
  },
  chapterSearchTool: {
    running: "Reading chapters",
    done: "Read chapters",
    icon: <BookOpenIcon className="size-3.5" />,
  },
  fileAnswerTool: {
    running: "Reading document",
    done: "Read document",
    icon: <FileTextIcon className="size-3.5" />,
  },
  webSearchTool: {
    running: "Searching the web",
    done: "Searched the web",
    icon: <GlobeIcon className="size-3.5" />,
  },
  webDocSearchTool: {
    running: "Searching online sources",
    done: "Searched online sources",
    icon: <GlobeIcon className="size-3.5" />,
  },
  webPageScrapeTool: {
    running: "Reading web page",
    done: "Read web page",
    icon: <GlobeIcon className="size-3.5" />,
  },
  bulkFileIndexingTool: {
    running: "Indexing documents",
    done: "Indexed documents",
    icon: <DatabaseIcon className="size-3.5" />,
  },
  fileStatusTool: {
    running: "Checking file status",
    done: "Checked file status",
    icon: <ActivityIcon className="size-3.5" />,
  },
};

function getRawName(part: ChatToolPart): string {
  if (part.toolName) return part.toolName;
  if (part.name) return part.name;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  if (part.type === "dynamic-tool") return "dynamic-tool";
  return "tool";
}

function humanize(name: string): string {
  return name
    .replace(/Tool$/, "")
    .replace(/Agent$/, "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function isRunningState(state?: string): boolean {
  return (
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested"
  );
}

function isErrorState(state?: string): boolean {
  return state === "output-error" || state === "output-denied";
}

export function ToolPart({ part }: { part: ChatToolPart }) {
  const rawName = getRawName(part);
  const display = TOOL_DISPLAY[rawName];
  const state = part.state ?? part.type;
  const running = isRunningState(state);
  const error = isErrorState(state);
  const label = display
    ? running
      ? display.running
      : display.done
    : `${running ? "Running" : "Used"} ${humanize(rawName)}`;

  const [open, setOpen] = useState(false);
  const hasDetails = part.input != null || part.output != null || !!part.errorText;

  const StatusIcon = running ? Loader2Icon : error ? XCircleIcon : CheckCircle2Icon;
  const statusClass = running
    ? "size-3.5 animate-spin text-muted-foreground"
    : error
      ? "size-3.5 text-destructive"
      : "size-3.5 text-emerald-600";

  const row = (
    <div className="flex w-full items-center gap-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
      <span className="flex size-5 items-center justify-center text-muted-foreground">
        {display ? display.icon : <WrenchIcon className="size-3.5" />}
      </span>
      <span className={running ? "italic text-foreground/80" : "text-foreground"}>
        {label}
        {running && "…"}
      </span>
      <StatusIcon className={statusClass} />
      {hasDetails && (
        <ChevronRightIcon
          className={`ml-auto size-3.5 text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
      )}
    </div>
  );

  if (!hasDetails) {
    return <div className="not-prose px-1">{row}</div>;
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="not-prose -mx-1"
    >
      <CollapsibleTrigger className="block w-full rounded-md px-1 text-left hover:bg-muted/40">
        {row}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-1 pl-7 pr-1 pt-1">
        {part.input != null && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Input
            </p>
            <CodeBlock code={JSON.stringify(part.input, null, 2)} language="json" />
          </div>
        )}
        {part.output != null && !error && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Output
            </p>
            <CodeBlock
              code={
                typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output, null, 2)
              }
              language="json"
            />
          </div>
        )}
        {part.errorText && (
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-destructive">
              Error
            </p>
            <p className="text-xs text-destructive">{part.errorText}</p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
