import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";

export type ChatSourcePart = {
  type: "source-url" | "source-document" | string;
  url?: string;
  title?: string;
  filename?: string;
};

type Props = { parts: ChatSourcePart[] };

export function SourcesPart({ parts }: Props) {
  if (!parts.length) return null;
  return (
    <Sources>
      <SourcesTrigger count={parts.length} />
      <SourcesContent>
        {parts.map((p, i) => {
          const href = p.url ?? "#";
          const title = p.title ?? p.filename ?? p.url ?? "Untitled source";
          return <Source key={i} href={href} title={title} />;
        })}
      </SourcesContent>
    </Sources>
  );
}
