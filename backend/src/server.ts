import "reflect-metadata";
import express from "express";
import cors from "cors";
import { container } from "./container";
import { LogIngestor } from "./ingestion/log-ingestor";
import { IMemoryRepository } from "./repository/IMemoryRepository";
import { MemoryRepository } from "./repository/memory.repository";
import { ParserRegistry } from "./parser/parser-registry";
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

// --- Health Probe (always 200 if process alive) ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// --- Readiness Probe (reflects repository state) ---
app.get("/ready", (_req, res) => {
  const repo = container.resolve<MemoryRepository>("IMemoryRepository");
  const state = repo.getState();
  const stats = repo.getStats();

  // Get active parser format
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

// --- Startup: Ingest log file asynchronously ---
async function startServer() {
  app.listen(PORT, () => {
    logger.info({ msg: `Server running on port ${PORT}` });
  });

  // Resolve the log file path
  const logFilePath = path.resolve(LOG_FILE_PATH);

  if (!existsSync(logFilePath)) {
    logger.error({ msg: "Log file not found", path: logFilePath });
    const repo = container.resolve<IMemoryRepository>("IMemoryRepository");
    repo.setState("$FAILED$");
    return;
  }

  logger.info({ msg: "Starting log ingestion", path: logFilePath });

  // Ingest asynchronously — server is already listening for /health and /ready
  const ingestor = container.resolve(LogIngestor);
  const stream = createReadStream(logFilePath, { encoding: "utf-8" });
  await ingestor.ingestStream(stream);
}

startServer().catch((err) => {
  logger.error({ msg: "Fatal startup error", error: err });
  process.exit(1);
});

export default app;
