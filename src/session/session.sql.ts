// Drizzle schema — Session, Message, Part

import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core"

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  title: text("title"),
  directory: text("directory"),
  timeCreated: integer("time_created").notNull(),
  timeUpdated: integer("time_updated").notNull(),
})

export const message = sqliteTable("message", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => session.id),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  modelId: text("model_id"),
  providerId: text("provider_id"),
  finish: text("finish", { enum: ["stop", "tool-calls", "length"] }),
  cost: real("cost"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  timeCreated: integer("time_created").notNull(),
  timeCompleted: integer("time_completed"),
})

export const part = sqliteTable("part", {
  id: text("id").primaryKey(),
  messageId: text("message_id")
    .notNull()
    .references(() => message.id),
  sessionId: text("session_id")
    .notNull()
    .references(() => session.id),
  type: text("type", {
    enum: ["text", "tool", "step-start", "step-finish", "summary"],
  }).notNull(),
  data: text("data").notNull(), // JSON blob
})
