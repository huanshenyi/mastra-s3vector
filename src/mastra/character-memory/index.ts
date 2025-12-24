/**
 * キャラクターメモリRAG
 *
 * S3Vectorsを使用したキャラクターAIエージェントの思い出RAGシステム
 */

// 型定義
export * from './types';

// ベクトルストア
export {
  createCharacterMemoryStore,
  ensureIndex,
  generateVectorId,
  CHARACTER_MEMORY_INDEX,
  EMBEDDING_DIMENSION,
} from './vector-store';

// メモリ抽出
export { extractMemoryFromEpisode, extractMemoryTool } from './extract-memory';

// Ingestワークフロー
export {
  ingestEpisode,
  ingestEpisodeWorkflow,
  deleteEpisodeVectors,
} from './ingest-workflow';

// メモリ検索
export {
  searchCharacterMemory,
  characterMemorySearchTool,
  getAllMemoriesUpToEpisode,
} from './memory-search-tool';

// キャラクターエージェント
export {
  createCharacterAgent,
  characterAgentFactory,
  talkAsCharacterTool,
  characterAgent,
} from './character-agent';
export type { CharacterRuntimeContext } from './character-agent';

// メモリクエリツール（createVectorQueryTool使用）
export {
  characterMemoryQueryTool,
  createMemoryFilter,
} from './memory-query-tool';
