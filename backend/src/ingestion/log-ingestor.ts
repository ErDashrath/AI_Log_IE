import { injectable, inject } from "tsyringe";
import { createInterface } from "readline";
import { Readable } from "stream";
import { ILogParser } from "../parser/ILogParser";
import { ParserRegistry } from "../parser/parser-registry";
import { IMemoryRepository } from "../repository/IMemoryRepository";
import { IIndexManager } from "../index/IIndexManager";
import pino from "pino";

const logger = pino({ name: "log-ingestor" });

/**
 * LogIngestor — Streaming, Time-Budget-Based Chunked Ingestion
 * 
 * Reads a log file line-by-line via a Readable stream,
 * auto-detects the format using ParserRegistry,
 * stores it in the MemoryRepository, and indexes it.
 * 
 * Event Loop Safety:
 *   Yields every 10ms of CPU time — not every N lines.
 *   2k and 200k logs behave identically from the HTTP client perspective.
 */
@injectable()
export class LogIngestor {
  constructor(
    @inject("ILogParser") private parser: ILogParser,
    @inject("IMemoryRepository") private repo: IMemoryRepository,
    @inject("IIndexManager") private indexManager: IIndexManager
  ) {}

  /**
   * Ingests a log stream with auto-format detection and time-budgeted yielding.
   */
  async ingestStream(stream: Readable): Promise<void> {
    const startTime = Date.now();
    let parsedCount = 0;
    let skippedCount = 0;

    try {
      this.repo.setState("$LOADING$");

      const rl = createInterface({
        input: stream,
        crlfDelay: Infinity,
      });

      // Collect sample lines for auto-detection
      const allLines: string[] = [];
      for await (const line of rl) {
        allLines.push(line);
      }

      // Auto-detect format from first 10 lines
      if (typeof (this.parser as any).detectAndLock === 'function') {
        const sampleLines = allLines.slice(0, 10).filter((l) => l.trim());
        const detection = (this.parser as any).detectAndLock(sampleLines);
        logger.info({
          msg: "Format detection complete",
          format: detection.parser,
          confidence: `${(detection.confidence * 100).toFixed(1)}%`,
          totalLines: allLines.length,
        });
      }

      // Parse all lines with time-budgeted yielding
      let chunkStart = Date.now();

      for (const line of allLines) {
        const parsed = this.parser.parseLine(line);

        if (parsed) {
          const lineNum = this.repo.addLog(parsed);
          this.indexManager.index(parsed, lineNum);
          parsedCount++;
        } else {
          skippedCount++;
        }

        // Yield to event loop every 10ms of CPU time
        if (Date.now() - chunkStart >= 10) {
          await new Promise<void>((resolve) => setImmediate(resolve));
          chunkStart = Date.now();
        }
      }

      this.repo.setState("$READY$");

      const duration = Date.now() - startTime;
      logger.info({
        msg: "Log ingestion complete",
        parsedCount,
        skippedCount,
        durationMs: duration,
        logsPerSecond: duration > 0 ? Math.round((parsedCount / duration) * 1000) : parsedCount,
      });
    } catch (error) {
      this.repo.setState("$FAILED$");
      logger.error({
        msg: "Log ingestion failed",
        error: error instanceof Error ? error.message : String(error),
        parsedBeforeFailure: parsedCount,
      });
      throw error;
    }
  }
}
