CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Board_search_trgm_idx"
ON "Board"
USING GIN (
  (lower("title" || ' ' || "description" || ' ' || COALESCE("groupName", '') || ' ' || "content")) gin_trgm_ops
);
