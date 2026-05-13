import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon } from "lucide-react";

import { MessageResponse } from "@/components/ai-elements/message";
import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { lookupPlaygroundFiles } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";

type Props = {
  text: string;
  isUser: boolean;
};

const FILE_ID = /file_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g;
// Any bracket pair containing at least one file_<uuid>. The model sometimes
// adds metadata inside (e.g. `/page=1`, comma-separated lists, surrounding
// spaces); we consume the whole bracket and re-render only the file id chips.
const BRACKETED_CITATION = /\[([^\]\n]*file_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[^\]\n]*)\]/g;
// Web-source citation emitted by the FinAgent prompt: `[url=https://…]`.
const URL_CITATION = /\[url=(https?:\/\/[^\]\s]+)\]/g;

function shortId(fileId: string): string {
  const uuid = fileId.slice("file_".length);
  return `${uuid.slice(0, 4)}…${uuid.slice(-4)}`;
}

function citeTag(id: string): string {
  // Strip the "file_" prefix in the attribute so the second pass below doesn't
  // re-match the id sitting inside our own tag and create nested wrappers.
  // FileCite reattaches the prefix on render.
  const uuid = id.slice("file_".length);
  return `<filecite cite_uuid="${uuid}">${shortId(id)}</filecite>`;
}

function urlHostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function urlCiteTag(url: string): string {
  // Encode the URL so it survives HTML-attribute parsing; WebCite decodes.
  return `<webcite cite_url="${encodeURIComponent(url)}">${urlHostLabel(url)}</webcite>`;
}

function preprocessCitations(text: string): string {
  let out = text.replace(BRACKETED_CITATION, (match, content: string) => {
    const ids = content.match(FILE_ID);
    if (!ids) return match;
    return ids.map(citeTag).join(" ");
  });
  out = out.replace(URL_CITATION, (_match, url: string) => urlCiteTag(url));
  out = out.replace(FILE_ID, citeTag);
  return out;
}

type FileCiteProps = {
  // Streamdown forwards element attributes that are listed in allowedTags.
  // We attach the bare UUID; FileCite reconstructs the full file_<uuid> id.
  cite_uuid?: string;
  children?: React.ReactNode;
};

function FileCite({ cite_uuid, children }: FileCiteProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const fileId = cite_uuid ? `file_${cite_uuid}` : null;

  const metadataQuery = useQuery({
    queryKey: ["playground-file-metadata", cite_uuid],
    queryFn: async () => {
      if (!cite_uuid || !accessToken) return null;
      const res = await lookupPlaygroundFiles(accessToken, [cite_uuid]);
      return res.items[cite_uuid] ?? null;
    },
    enabled: open && !!cite_uuid && !!accessToken,
    staleTime: 5 * 60 * 1000,
  });

  if (!cite_uuid || !fileId) {
    return <span>{children}</span>;
  }

  const copy = () => {
    void navigator.clipboard.writeText(fileId);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const meta = metadataQuery.data;

  return (
    <HoverCard openDelay={120} closeDelay={80} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>
        <span className="not-prose mx-0.5 inline-flex cursor-pointer items-baseline rounded border border-border bg-muted/60 px-1 align-baseline font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="start"
        className="w-auto max-w-[460px] p-3"
      >
        <div className="flex flex-col gap-2">
          {meta ? (
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <p className="font-medium text-sm leading-snug">{meta.title}</p>
              </div>
              {(meta.documentType || meta.year) && (
                <div className="flex flex-wrap gap-1">
                  {meta.documentType && (
                    <span className="rounded border border-border bg-muted/50 px-1.5 py-0 text-[10px] text-muted-foreground">
                      {meta.documentType}
                    </span>
                  )}
                  {meta.year && (
                    <span className="rounded border border-border bg-muted/50 px-1.5 py-0 text-[10px] text-muted-foreground">
                      {meta.year}
                    </span>
                  )}
                </div>
              )}
              {meta.summary && (
                <p className="text-xs leading-snug text-muted-foreground">{meta.summary}</p>
              )}
            </div>
          ) : metadataQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading source…</p>
          ) : metadataQuery.isError ? (
            <p className="text-xs text-destructive">Failed to load source.</p>
          ) : metadataQuery.isFetched && !meta ? (
            <p className="text-xs text-muted-foreground">Source not found.</p>
          ) : null}

          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              File ID
            </p>
            <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
              {fileId}
            </p>
          </div>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={copy}
            >
              {copied ? (
                <>
                  <CheckIcon className="size-3" />
                  Copied
                </>
              ) : (
                <>
                  <CopyIcon className="size-3" />
                  Copy ID
                </>
              )}
            </Button>
            {meta?.url && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                asChild
              >
                <a href={meta.url} target="_blank" rel="noopener noreferrer">
                  Open
                </a>
              </Button>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

type WebCiteProps = {
  cite_url?: string;
  children?: React.ReactNode;
};

function WebCite({ cite_url, children }: WebCiteProps) {
  if (!cite_url) return <span>{children}</span>;
  let url: string;
  try {
    url = decodeURIComponent(cite_url);
  } catch {
    return <span>{children}</span>;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
      className="not-prose mx-0.5 inline-flex cursor-pointer items-baseline rounded border border-border bg-muted/60 px-1 align-baseline font-mono text-[10px] text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
    >
      {children}
    </a>
  );
}

const responseAllowedTags = {
  filecite: ["cite_uuid"],
  webcite: ["cite_url"],
};
const responseLiteralTagContent = ["filecite", "webcite"];
// `components` here is keyed by tag name. Streamdown forwards element attributes
// to the component, so `file_id` lands as a prop.
const responseComponents = {
  filecite: FileCite as never,
  webcite: WebCite as never,
};

export function TextPart({ text, isUser }: Props) {
  if (!text) return null;
  if (isUser) {
    return <p className="m-0 whitespace-pre-wrap">{text}</p>;
  }
  return (
    <MessageResponse
      allowedTags={responseAllowedTags}
      literalTagContent={responseLiteralTagContent}
      components={responseComponents}
    >
      {preprocessCitations(text)}
    </MessageResponse>
  );
}
