import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { MODES, type ChatMode } from "./modeConfig";

type Props = {
  mode: ChatMode;
  onSelect: (text: string) => void;
};

export function ModeSuggestions({ mode, onSelect }: Props) {
  const suggestions = MODES[mode].suggestions;
  return (
    <Suggestions>
      {suggestions.map((s) => (
        <Suggestion key={s} suggestion={s} onClick={onSelect} />
      ))}
    </Suggestions>
  );
}
