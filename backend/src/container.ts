import "reflect-metadata";
import { container, Lifecycle } from "tsyringe";
import { ILogParser } from "./parser/ILogParser";
import { ParserRegistry } from "./parser/parser-registry";
import { IMemoryRepository } from "./repository/IMemoryRepository";
import { MemoryRepository } from "./repository/memory.repository";
import { IIndexManager } from "./index/IIndexManager";
import { IndexManager } from "./index/index-manager";
import { IRetrievalFactory } from "./retrieval/IRetrievalFactory";
import { RetrievalStrategyFactory } from "./retrieval/retrieval-factory";

/**
 * Dependency Injection Container
 * 
 * All interface-to-implementation bindings are registered here.
 * Controllers and services declare dependencies via @inject() decorators —
 * they never call new() on a concrete class.
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

// Retrieval — factory creates per-request strategies
container.register<IRetrievalFactory>("IRetrievalFactory", {
  useClass: RetrievalStrategyFactory,
});

// --- Phase 4 binding will be added below ---
// container.register<IAIService>("IAIService", { ... });

export { container };
