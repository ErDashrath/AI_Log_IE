import "dotenv/config";
import "reflect-metadata";
import express from "express";
import cors from "cors";
import { container } from "./container";
import { LogIngestor } from "./ingestion/log-ingestor";
import { IMemoryRepository } from "./repository/IMemoryRepository";
import { MemoryRepository } from "./repository/memory.repository";
import { ParserRegistry } from "./parser/parser-registry";
import { IndexManager } from "./index/index-manager";
import { LogClassificationController } from "./controllers/log-classification.controller";
import { IncidentTimelineController } from "./controllers/incident-timeline.controller";
import { RootCauseAnalysisController } from "./controllers/root-cause-analysis.controller";
import { readinessGuard } from "./middleware/readiness.middleware";
import { rateLimiter } from "./middleware/rate-limit.middleware";
import { createReadStream, existsSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { Readable } from "stream";
import pino from "pino";

const logger = pino({ name: "server" });

const app = express();
const PORT = process.env.PORT || 3001;
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || "Apache_2k.log";

// --- Global Middleware ---
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.text({ limit: "50mb", type: "text/plain" }));
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
  const activeFormat = typeof (parser as any).getActiveFormat === 'function' ? (parser as any).getActiveFormat() : "unknown";
  const supportedFormats = typeof (parser as any).getSupportedFormats === 'function' ? (parser as any).getSupportedFormats() : [];

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

  // Idle state (no file uploaded yet)
  return res.status(200).json({
    ready: false,
    state: state,
    logsIngested: 0,
    message: "No log file loaded. Upload a file to begin.",
  });
});

// --- File Upload Endpoint ---
app.post("/api/upload", async (req, res) => {
  try {
    let logContent: string;

    if (typeof req.body === "string") {
      // text/plain upload
      logContent = req.body;
    } else if (req.body && req.body.content) {
      // JSON { content: "..." } upload
      logContent = req.body.content;
    } else {
      return res.status(400).json({
        success: false,
        message: "Send log file content as text/plain body or JSON { content: '...' }",
      });
    }

    if (!logContent || logContent.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: "Log file content is empty",
      });
    }

    const repo = container.resolve<MemoryRepository>("IMemoryRepository");

    // Reset repository and indexes for new file
    repo.reset();
    const indexMgr = container.resolve<IndexManager>("IIndexManager");
    indexMgr.reset();

    // Reset parser registry for new detection
    const parser = container.resolve<ParserRegistry>("ILogParser");
    if (typeof (parser as any).resetDetection === 'function') {
      (parser as any).resetDetection();
    }
    
    // Fallback parser property reset
    const activeFormat = typeof (parser as any).getActiveFormat === 'function' 
      ? (parser as any).getActiveFormat() 
      : "unknown";

    logger.info({ msg: "File upload received", contentLength: logContent.length });

    // Create a readable stream from the uploaded content
    const stream = Readable.from(logContent);

    const ingestor = container.resolve(LogIngestor);
    await ingestor.ingestStream(stream);

    const stats = repo.getStats();
    res.status(200).json({
      success: true,
      message: "Log file processed successfully",
      data: {
        logsIngested: stats.totalLogs,
        detectedFormat: typeof (parser as any).getActiveFormat === 'function' 
          ? (parser as any).getActiveFormat() 
          : "unknown",
        stats,
      },
    });
  } catch (error) {
    logger.error({
      msg: "File upload failed",
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      success: false,
      message: "Failed to process log file",
    });
  }
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

// --- Startup ---
async function startServer() {
  app.listen(PORT, () => {
    logger.info({ msg: `Server running on port ${PORT}` });
    logger.info({ msg: "API Endpoints available:", endpoints: [
      "POST /api/upload              — Upload any log file",
      "POST /api/ai/log-classification — Classify logs",
      "POST /api/ai/incident-timeline  — Generate timeline",
      "POST /api/ai/root-cause-analysis — Root cause analysis",
      "GET  /health                  — Health probe",
      "GET  /ready                   — Readiness probe",
    ]});
  });

  // Auto-ingest default log file if it exists
  const logFilePath = path.resolve(LOG_FILE_PATH);
  if (existsSync(logFilePath)) {
    logger.info({ msg: "Auto-ingesting default log file", path: logFilePath });
    const ingestor = container.resolve(LogIngestor);
    const stream = createReadStream(logFilePath, { encoding: "utf-8" });
    await ingestor.ingestStream(stream);
  } else {
    logger.info({ msg: "No default log file found. Waiting for upload.", path: logFilePath });
  }
}

startServer().catch((err) => {
  logger.error({ msg: "Fatal startup error", error: err });
  process.exit(1);
});

export default app;
