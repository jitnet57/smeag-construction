import { initSchema, seedIfEmpty, db } from "./db.js";

console.log("Initializing database schema...");
initSchema();

console.log("Seeding database...");
seedIfEmpty();

console.log("Done!");
process.exit(0);
