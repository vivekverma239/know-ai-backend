-- Drop old constraints and re-add with CASCADE
-- file_page
ALTER TABLE "file_page" DROP CONSTRAINT IF EXISTS "file_page_fileId_user_file_id_fk";
ALTER TABLE "file_page" ADD CONSTRAINT "file_page_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "user_file"("id") ON DELETE CASCADE;

-- user_file_to_c_meta
ALTER TABLE "user_file_to_c_meta" DROP CONSTRAINT IF EXISTS "user_file_to_c_meta_fileId_user_file_id_fk";
ALTER TABLE "user_file_to_c_meta" ADD CONSTRAINT "user_file_to_c_meta_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "user_file"("id") ON DELETE CASCADE;

-- file_cluster
ALTER TABLE "file_cluster" DROP CONSTRAINT IF EXISTS "file_cluster_fileId_user_file_id_fk";
ALTER TABLE "file_cluster" ADD CONSTRAINT "file_cluster_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "user_file"("id") ON DELETE CASCADE;

-- file_chapter
ALTER TABLE "file_chapter" DROP CONSTRAINT IF EXISTS "file_chapter_fileId_user_file_id_fk";
ALTER TABLE "file_chapter" ADD CONSTRAINT "file_chapter_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "user_file"("id") ON DELETE CASCADE;

-- file_section
ALTER TABLE "file_section" DROP CONSTRAINT IF EXISTS "file_section_fileId_user_file_id_fk";
ALTER TABLE "file_section" ADD CONSTRAINT "file_section_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "user_file"("id") ON DELETE CASCADE;

-- file_heirarchial_index
ALTER TABLE "file_heirarchial_index" DROP CONSTRAINT IF EXISTS "file_heirarchial_index_fileId_user_file_id_fk";
ALTER TABLE "file_heirarchial_index" ADD CONSTRAINT "file_heirarchial_index_fileId_user_file_id_fk" FOREIGN KEY ("fileId") REFERENCES "user_file"("id") ON DELETE CASCADE;

-- chunk (new FK)
ALTER TABLE "chunk" ADD CONSTRAINT "chunk_documentId_user_file_id_fk" FOREIGN KEY ("documentId") REFERENCES "user_file"("id") ON DELETE CASCADE;
