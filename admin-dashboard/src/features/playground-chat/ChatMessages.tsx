import type { ChatStatus, UIMessage } from "ai";
import { CopyIcon, RefreshCcwIcon } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { Spinner } from "@/components/ui/spinner";
import { TextPart } from "./parts/TextPart";
import { FilePart } from "./parts/FilePart";
import { ToolList, type ChatToolPart } from "./parts/ToolPart";
import { ReasoningPart } from "./parts/ReasoningPart";
import { SourcesPart, type ChatSourcePart } from "./parts/SourcesPart";

type Props = {
  messages: UIMessage[];
  status: ChatStatus;
  onRegenerate: () => void;
};

type AnyPart = {
  type: string;
  text?: string;
  url?: string;
  mediaType?: string;
  filename?: string;
  state?: string;
  toolName?: string;
  name?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  title?: string;
};

function gatherText(parts: AnyPart[]): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("");
}

function gatherReasoning(parts: AnyPart[]): string {
  return parts
    .filter((p) => p.type === "reasoning" && p.text)
    .map((p) => p.text!)
    .join("");
}

function gatherSources(parts: AnyPart[]): ChatSourcePart[] {
  return parts.filter(
    (p) => p.type === "source-url" || p.type === "source-document",
  ) as ChatSourcePart[];
}

export function ChatMessages({ messages, status, onRegenerate }: Props) {
  const isSubmitted = status === "submitted";
  const isStreaming = status === "streaming";
  const lastMessage = messages[messages.length - 1];
  const lastAssistantHasNoText =
    lastMessage?.role === "assistant" &&
    !gatherText((lastMessage.parts ?? []) as AnyPart[]);
  const showSpinnerRow = isSubmitted && (!lastMessage || lastMessage.role === "user");

  return (
    <Conversation className="flex-1 min-h-0">
      <ConversationContent>
        {messages.map((msg, msgIndex) => {
          const parts = (msg.parts ?? []) as AnyPart[];
          const text = gatherText(parts);
          const reasoning = gatherReasoning(parts);
          const sources = gatherSources(parts);
          const tools = parts.filter(
            (p) => p.type.startsWith("tool-") || p.type === "dynamic-tool",
          );
          const files = parts.filter((p) => p.type === "file");
          const isLast = msgIndex === messages.length - 1;
          const isAssistant = msg.role === "assistant";
          const isAssistantStreaming =
            isAssistant && isLast && (isStreaming || (lastAssistantHasNoText && isSubmitted));

          return (
            <Message key={msg.id} from={msg.role}>
              <MessageContent>
                {isAssistant && reasoning && (
                  <ReasoningPart text={reasoning} isStreaming={isAssistantStreaming} />
                )}

                {tools.length > 0 && (
                  <ToolList parts={tools as ChatToolPart[]} />
                )}

                <TextPart text={text} isUser={msg.role === "user"} />

                {files.map((f, i) => (
                  <FilePart
                    key={`file-${i}`}
                    url={f.url ?? ""}
                    mediaType={f.mediaType ?? "application/octet-stream"}
                    filename={f.filename}
                  />
                ))}

                {/* If assistant has streamed parts but no text yet, show a spinner inline */}
                {isAssistant && !text && isAssistantStreaming && <Spinner />}

                {isAssistant && !isAssistantStreaming && <SourcesPart parts={sources} />}

                {isAssistant && text && !isAssistantStreaming && (
                  <MessageActions className="mt-1">
                    <MessageAction
                      tooltip="Copy"
                      onClick={() => navigator.clipboard.writeText(text)}
                    >
                      <CopyIcon className="size-3.5" />
                    </MessageAction>
                    {isLast && (
                      <MessageAction tooltip="Regenerate" onClick={onRegenerate}>
                        <RefreshCcwIcon className="size-3.5" />
                      </MessageAction>
                    )}
                  </MessageActions>
                )}
              </MessageContent>
            </Message>
          );
        })}

        {showSpinnerRow && (
          <Message from="assistant">
            <MessageContent>
              <Spinner />
            </MessageContent>
          </Message>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}
