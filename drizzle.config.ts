import { defineConfig } from "drizzle-kit"

export default defineConfig({
  schema: "./src/session/session.sql.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: "atom.db",
  },
})
