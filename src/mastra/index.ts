
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { S3Vectors } from '@mastra/s3vectors';
import { weatherWorkflow } from './workflows/weather-workflow';
import { weatherAgent } from './agents/weather-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { ingestEpisodeWorkflow } from './character-memory/ingest-workflow';
import { characterAgent } from './character-memory/character-agent';

// S3Vectorsの初期化
const s3Vectors = new S3Vectors({
  vectorBucketName: process.env.S3_VECTORS_BUCKET_NAME || 'character-memory-vectors',
  clientConfig: {
    region: process.env.AWS_REGION || 'us-east-1',
  },
  nonFilterableMetadataKeys: ['text'],
});

export const mastra = new Mastra({
  workflows: {
    weatherWorkflow,
    ingestEpisodeWorkflow,
  },
  agents: {
    weatherAgent,
    characterAgent,  // RuntimeContext対応キャラクターエージェント
  },
  vectors: {
    s3Vectors,  // S3Vectorsをベクトルストアとして登録
  },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new LibSQLStore({
    // stores observability, scores, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ":memory:",
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false,
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true },
  },
});

// キャラクターメモリ関連をエクスポート
export * from './character-memory';
