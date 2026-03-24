CREATE INDEX "chunk_embedding_hnsw_idx" ON "chunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX "user_file_embedding_hnsw_idx" ON "user_file" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX "file_chapter_embedding_hnsw_idx" ON "file_chapter" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX "file_cluster_embedding_hnsw_idx" ON "file_cluster" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
