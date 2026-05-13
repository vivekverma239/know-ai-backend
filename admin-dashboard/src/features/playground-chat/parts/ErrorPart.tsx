import { AlertTriangleIcon } from "lucide-react";

type Props = {
  message: string;
  code?: string;
};

const TITLES: Record<string, string> = {
  "stream-error": "Stream error",
  "stream-exception": "Stream exception",
  "empty-response": "No response",
};

export function ErrorPart({ message, code }: Props) {
  const title = (code && TITLES[code]) ?? "Something went wrong";
  return (
    <div className="not-prose my-1 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive-foreground">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-destructive">{title}</p>
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
