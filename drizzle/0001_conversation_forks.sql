ALTER TABLE "conversations" ADD COLUMN "parent_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "forked_from_message_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_parent_conversation_id_conversations_id_fk" FOREIGN KEY ("parent_conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_forked_from_message_id_messages_id_fk" FOREIGN KEY ("forked_from_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_parent_idx" ON "conversations" USING btree ("parent_conversation_id");