DROP INDEX "calendar_events_entities_rel_pk";--> statement-breakpoint
DROP INDEX "highlights_entities_rel_pk";--> statement-breakpoint
DROP INDEX "highlights_tags_rel_pk";--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_entities_rel_pk" ON "ext_calendar_events_entities_rel" USING btree ("calendar_event_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "highlights_entities_rel_pk" ON "ext_highlights_entities_rel" USING btree ("highlight_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "highlights_tags_rel_pk" ON "ext_highlights_tags_rel" USING btree ("highlight_id","tag_id");