import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";

type Props = {
  text: string;
  isStreaming: boolean;
};

export function ReasoningPart({ text, isStreaming }: Props) {
  if (!text) return null;
  return (
    <Reasoning isStreaming={isStreaming}>
      <ReasoningTrigger />
      <ReasoningContent>{text}</ReasoningContent>
    </Reasoning>
  );
}
