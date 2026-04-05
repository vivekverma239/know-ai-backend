import path from "node:path";

/** Root directory for all eval data — all manifest paths are relative to this */
export const EVAL_DATA_ROOT = path.resolve(import.meta.dirname, "../../eval-data");
