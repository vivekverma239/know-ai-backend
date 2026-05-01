type Props = {
  url: string;
  mediaType: string;
  filename?: string;
};

export function FilePart({ url, mediaType, filename }: Props) {
  if (mediaType.startsWith("image/")) {
    return (
      <img
        src={url}
        alt={filename ?? "attachment"}
        className="mt-2 max-h-64 max-w-full rounded-md border border-border object-contain"
      />
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 inline-block text-xs text-primary underline"
    >
      {filename ?? "attachment"} ({mediaType})
    </a>
  );
}
