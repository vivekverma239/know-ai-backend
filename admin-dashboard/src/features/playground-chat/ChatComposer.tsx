import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import type { ChatStatus } from "ai";
import { XIcon } from "lucide-react";
import { useState } from "react";

const MAX_FILES = 4;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

type Props = {
  status: ChatStatus;
  onSend: (msg: PromptInputMessage) => void;
  onStop: () => void;
  disabled?: boolean;
};

function AttachmentChips() {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <PromptInputHeader>
      {attachments.files.map((file) => (
        <div key={file.id} className="relative">
          {file.mediaType?.startsWith("image/") && file.url ? (
            <img
              alt={file.filename ?? "attachment"}
              src={file.url}
              className="h-14 w-14 rounded-md border border-border object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground">
              {file.filename ?? "file"}
            </div>
          )}
          <button
            type="button"
            onClick={() => attachments.remove(file.id)}
            aria-label={`Remove ${file.filename ?? "attachment"}`}
            className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-background text-[10px] shadow ring-1 ring-border hover:bg-muted"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ))}
    </PromptInputHeader>
  );
}

export function ChatComposer({ status, onSend, onStop, disabled }: Props) {
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const isActive = status === "streaming" || status === "submitted";

  return (
    <div className="border-t border-border">
      {attachmentError && (
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={() => setAttachmentError(null)}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive hover:bg-destructive/20"
          >
            {attachmentError} ✕
          </button>
        </div>
      )}
      <PromptInput
        accept="image/*"
        multiple
        maxFiles={MAX_FILES}
        maxFileSize={MAX_FILE_SIZE}
        onError={(err) => setAttachmentError(err.message)}
        onSubmit={(message) => {
          setAttachmentError(null);
          if (!message.text.trim() && message.files.length === 0) return;
          if (isActive) return;
          onSend(message);
        }}
      >
        <AttachmentChips />
        <PromptInputTextarea
          placeholder="Type a message..."
          disabled={disabled}
        />
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputSubmit
            status={status}
            onStop={onStop}
            disabled={disabled}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}
