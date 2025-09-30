import { Type } from "@sinclair/typebox";

export const TaskExecuteBody = Type.Object({
  type: Type.Union([
    Type.Literal("web_search_processing"),
    Type.Literal("parse_pdf"),
    Type.Literal("recompute_embeddings"),
  ]),
  data: Type.Record(Type.String(), Type.Unknown()),
});

export const OkResponse = Type.Object({ ok: Type.Boolean() });
