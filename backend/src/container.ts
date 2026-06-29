import "reflect-metadata";
import { container, Lifecycle } from "tsyringe";
import { ILogParser } from "./parser/ILogParser";
import { ParserRegistry } from "./parser/parser-registry";
import { IMemoryRepository } from "./repository/IMemoryRepository";
import { MemoryRepository } from "./repository/memory.repository";
import { IIndexManager } from "./index/IIndexManager";
import { IndexManager } from "./index/index-manager";

/**
 * Dependency Injection Container
 * 
 * All interface-to-implementation bindings are registered here.
 * Controllers and services declare dependencies via @inject() decorators —
 * they never call new() on a concrete class.
 * 
 * Log Format Support:
 *   ParserRegistry handles auto-detection. It contains:
 *   - ApacheRegexParser (Apache error logs)
 *   - GenericParser (fallback for unknown formats)
 *   
 *   To add a new format, add the parser to ParserRegistry's parser list.
 *   No other code changes needed.
 */

// Parser — ParserRegistry auto-detects format from log content
container.register<ILogParser>("ILogParser", {
  useClass: ParserRegistry,
}, { lifecycle: Lifecycle.Singleton });

// Repository — singleton (one canonical ParsedLog[] for the process lifetime)
container.register<IMemoryRepository>("IMemoryRepository", {
  useClass: MemoryRepository,
}, { lifecycle: Lifecycle.Singleton });

// Index — singleton (indexes live as long as the repository)
container.register<IIndexManager>("IIndexManager", {
  useClass: IndexManager,
}, { lifecycle: Lifecycle.Singleton });

// --- Phase 3+ bindings will be added below ---
// container.register<IRetrievalFactory>("IRetrievalFactory", { ... });
// container.register<IAIService>("IAIService", { ... });

export { container };
