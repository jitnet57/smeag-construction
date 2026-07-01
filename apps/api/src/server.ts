import express from "express";
import cors from "cors";
import { initSchema, seedIfEmpty } from "./db.js";
import routes from "./routes.js";

const app = express();
const port = parseInt(process.env.PORT || "4000", 10);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database
initSchema();
seedIfEmpty();

// Mount routes
app.use("/api", routes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Start server
app.listen(port, () => {
  console.log(`BRIGHTEM Payroll API running on port ${port}`);
  console.log(`Base URL: http://localhost:${port}/api`);
});
