import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODES, type ChatMode } from "./modeConfig";

type Props = {
  mode: ChatMode;
  onChange: (mode: ChatMode) => void;
  disabled: boolean;
};

export function ChatModeBar({ mode, onChange, disabled }: Props) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-2 pb-2">
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
      <span className="ml-2 text-[11px] text-muted-foreground">
        Switching mode resets the session.
      </span>
    </div>
  );
}
