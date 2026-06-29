import "dotenv/config";
import "reflect-metadata";
import express from "express";
import cors from "cors";
import { container } from "./container";
import { LogIngestor } from "./ingestion/log-ingestor";
import { IMemoryRepository } from "./repository/IMemoryRepository";
import { MemoryRepository } from "./repository/memory.repository";
import { ParserRegistry } from "./parser/parser-registry";
import { LogClassificationController } from "./controllers/log-classification.controller";
import { IncidentTimelineController } from "./controllers/incident-timeline.controller";
import { RootCauseAnalysisController } from "./controllers/root-cause-analysis.controller";
import { readinessGuard } from "./middleware/readiness.middleware";
import { rateLimiter } from "./middleware/rate-limit.middleware";
import { createReadStream, existsSync } from "fs";
import path from "path";
import pino from "pino";

const logger = pino({ name: "server" });

const app = express();
const PORT = process.env.PORT || 3001;
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || "Apache_2k.log";

// --- Global Middleware ---
app.use(cors());
app.use(express.json());
app.use(rateLimiter);

// --- Health Probe (always 200 if process alive) ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// --- Readiness Probe (reflects repository state) ---
app.get("/ready", (_req, res) => {
  const repo = container.resolve<MemoryRepository>("IMemoryRepository");
  const state = repo.getState();
  const stats = repo.getStats();

  const parser = container.resolve<ParserRegistry>("ILogParser");
  const activeFormat = parser instanceof ParserRegistry ? parser.getActiveFormat() : "unknown";
  const supportedFormats = parser instanceof ParserRegistry ? parser.getSupportedFormats() : [];

  if (state === "$READY$") {
    return res.status(200).json({
      ready: true,
      logsIngested: stats.totalLogs,
      detectedFormat: activeFormat,
      supportedFormats,
      stats,
    });
  }

  if (state === "$LOADING$") {
    return res.status(503).json({
      ready: false,
      state: "$LOADING$",
      estimatedReadyMs: repo.estimatedReadyMs(),
    });
  }

  return res.status(500).json({
    ready: false,
    state: "$FAILED$",
    error: "Engine failed to initialize. Check logs.",
  });
});

// --- Readiness Guard: Applied ONCE before all /api/ai routes ---
const repo = container.resolve<IMemoryRepository>("IMemoryRepository");
app.use("/api/ai", readinessGuard(repo));

// --- AI API Routes ---
const classificationController = container.resolve(LogClassificationController);
const timelineController = container.resolve(IncidentTimelineController);
const rcaController = container.resolve(RootCauseAnalysisController);

app.post("/api/ai/log-classification", (req, res) =>
  classificationController.handle(req, res)
);

app.post("/api/ai/incident-timeline", (req, res) =>
  timelineController.handle(req, res)
);

app.post("/api/ai/root-cause-analysis", (req, res) =>
  rcaController.handle(req, res)
);

// --- Startup: Ingest log file asynchronously ---
async function startServer() {
  app.listen(PORT, () => {
    logger.info({ msg: `Server running on port ${PORT}` });
    logger.info({ msg: "API Endpoints available:", endpoints: [
      "POST /api/ai/log-classification",
      "POST /api/ai/incident-timeline",
      "POST /api/ai/root-cause-analysis",
      "GET  /health",
      "GET  /ready",
    ]});
  });

  const logFilePath = path.resolve(LOG_FILE_PATH);

  if (!existsSync(logFilePath)) {
    logger.error({ msg: "Log file not found", path: logFilePath });
    repo.setState("$FAILED$");
    return;
  }

  logger.info({ msg: "Starting log ingestion", path: logFilePath });

  const ingestor = container.resolve(LogIngestor);
  const stream = createReadStream(logFilePath, { encoding: "utf-8" });
  await ingestor.ingestStream(stream);
}

startServer().catch((err) => {
  logger.error({ msg: "Fatal startup error", error: err });
  process.exit(1);
});

export default app;
