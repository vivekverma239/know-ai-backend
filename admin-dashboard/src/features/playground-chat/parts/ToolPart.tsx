import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolHeaderProps,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

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

function getToolDisplayName(part: ChatToolPart): string {
  if (part.toolName) return part.toolName;
  if (part.name) return part.name;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length);
  if (part.type === "dynamic-tool") return "dynamic-tool";
  return "unknown";
}

export function ToolPart({ part }: { part: ChatToolPart }) {
  const name = getToolDisplayName(part);
  const state = (part.state ?? part.type) as never;

  const headerProps = {
    type: part.type,
    state,
    toolName: name,
  } as unknown as ToolHeaderProps;

  return (
    <Tool>
      <ToolHeader {...headerProps} />
      <ToolContent>
        {part.input != null && <ToolInput input={part.input} />}
        {part.output != null && (
          <ToolOutput output={part.output} errorText={part.errorText} />
        )}
      </ToolContent>
    </Tool>
  );
}
