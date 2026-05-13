import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AGENT_MODELS,
  FILE_ANSWER_MODELS,
  type ModelOption,
} from "./availableModels";
import { MODES, type ChatMode } from "./modeConfig";

type Props = {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled: boolean;
  /** FinAgent-only: tool-calling driver model. */
  agentModel?: string;
  onAgentModelChange?: (model: string) => void;
  /** FinAgent-only: model used inside fileAnswerTool. */
  fileAnswerModel?: string;
  onFileAnswerModelChange?: (model: string) => void;
};

function ModelSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ModelOption[];
  disabled: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-8 w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.id} value={opt.id}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ChatModeBar({
  mode,
  onChange,
  disabled,
  agentModel,
  onAgentModelChange,
  fileAnswerModel,
  onFileAnswerModelChange,
}: Props) {
  const showModelSelectors =
    mode === "finAgent" &&
    !!agentModel &&
    !!onAgentModelChange &&
    !!fileAnswerModel &&
    !!onFileAnswerModelChange;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 pb-2">
      <span className="text-xs text-muted-foreground">Mode:</span>
      <Select value={mode} onValueChange={(v) => onChange(v as ChatMode)} disabled={disabled}>
        <SelectTrigger className="h-8 w-[280px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(MODES) as ChatMode[]).map((m) => (
            <SelectItem key={m} value={m}>
              {MODES[m].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showModelSelectors && (
        <>
          <span className="ml-2 text-xs text-muted-foreground">Agent:</span>
          <ModelSelect
            value={agentModel}
            onChange={onAgentModelChange}
            options={AGENT_MODELS}
            disabled={disabled}
          />
          <span className="ml-2 text-xs text-muted-foreground">File answer:</span>
          <ModelSelect
            value={fileAnswerModel}
            onChange={onFileAnswerModelChange}
            options={FILE_ANSWER_MODELS}
            disabled={disabled}
          />
        </>
      )}

      <span className="ml-2 text-[11px] text-muted-foreground">
        Switching mode resets the session.
      </span>
    </div>
  );
}
