/**
 * エピソードIngestワークフロー
 *
 * 1. エピソードテキストを読み込む
 * 2. LLMで差分（facts）を抽出
 * 3. 各factを埋め込みベクトル化
 * 4. S3Vectorsにupsert
 */
import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { embed, embedMany } from 'ai';
import { createBedrockEmbeddingModel } from '../../lib/bedrock-providers';
import { extractMemoryFromEpisode } from './extract-memory';
import {
  CHARACTER_MEMORY_INDEX,
  createCharacterMemoryStore,
  ensureIndex,
  generateVectorId,
  getIndexName,
} from './vector-store';
import type { EpisodeDelta, MemoryVectorMetadata } from './types';

// 埋め込みモデル（Amazon Titan Embed V2）
const embeddingModel = createBedrockEmbeddingModel('amazon.titan-embed-text-v2:0');

// ワークフロー入力スキーマ
const ingestInputSchema = z.object({
  episodeId: z.string().describe('エピソードID'),
  episodeNo: z.number().describe('エピソード番号'),
  episodeText: z.string().describe('エピソードテキスト'),
  version: z.number().optional().default(1).describe('バージョン番号'),
});

// Step 1: 差分抽出
const extractStep = createStep({
  id: 'extract-memory',
  inputSchema: ingestInputSchema,
  outputSchema: z.object({
    delta: z.custom<EpisodeDelta>(),
  }),
  execute: async ({ inputData }) => {
    const delta = await extractMemoryFromEpisode(
      inputData.episodeText,
      inputData.episodeId,
      inputData.episodeNo,
      inputData.version ?? 1
    );
    return { delta };
  },
});

// Step 2: 埋め込み生成 & ベクトルストアにupsert
const embedAndUpsertStep = createStep({
  id: 'embed-and-upsert',
  inputSchema: z.object({
    delta: z.custom<EpisodeDelta>(),
  }),
  outputSchema: z.object({
    vectorIds: z.array(z.string()),
    factsCount: z.number(),
  }),
  execute: async ({ inputData }) => {
    const { delta } = inputData;

    if (delta.facts.length === 0) {
      return { vectorIds: [], factsCount: 0 };
    }

    // 各factのテキストを埋め込み
    const texts = delta.facts.map(f => f.text);
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: texts,
    });

    // メタデータを構築
    const vectorIds: string[] = [];
    const metadata: MemoryVectorMetadata[] = [];

    for (let i = 0; i < delta.facts.length; i++) {
      const fact = delta.facts[i];
      const vectorId = generateVectorId(
        delta.episodeId,
        delta.version,
        fact.scope,
        fact.characterId,
        i
      );
      vectorIds.push(vectorId);

      metadata.push({
        vectorId,
        episodeId: delta.episodeId,
        episodeNo: delta.episodeNo,
        version: delta.version,
        scope: fact.scope,
        characterId: fact.characterId || 'world',
        factIndex: i,
        text: fact.text,
        importance: fact.importance,
      });
    }

    // S3Vectorsにupsert
    const store = createCharacterMemoryStore();
    await ensureIndex(store);
    await store.upsert({
      indexName: CHARACTER_MEMORY_INDEX,
      vectors: embeddings,
      metadata,
      ids: vectorIds,
    });
    await store.disconnect();

    return { vectorIds, factsCount: delta.facts.length };
  },
});

/**
 * エピソードIngestワークフロー
 */
export const ingestEpisodeWorkflow = createWorkflow({
  id: 'ingest-episode',
  inputSchema: ingestInputSchema,
  outputSchema: z.object({
    episodeId: z.string(),
    episodeNo: z.number(),
    version: z.number(),
    factsCount: z.number(),
    vectorIds: z.array(z.string()),
  }),
})
  .then(extractStep)
  .then(embedAndUpsertStep)
  .commit();

/**
 * 単体でエピソードをIngestする関数
 * @param storyId 物語ID（インデックス名に使用）
 */
export async function ingestEpisode(
  episodeId: string,
  episodeNo: number,
  episodeText: string,
  version: number = 1,
  storyId?: string
): Promise<{
  episodeId: string;
  episodeNo: number;
  version: number;
  factsCount: number;
  vectorIds: string[];
}> {
  // 1. 差分抽出
  const delta = await extractMemoryFromEpisode(
    episodeText,
    episodeId,
    episodeNo,
    version
  );

  if (delta.facts.length === 0) {
    return {
      episodeId,
      episodeNo,
      version,
      factsCount: 0,
      vectorIds: [],
    };
  }

  // 2. 埋め込み生成
  const texts = delta.facts.map(f => f.text);
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
  });

  // 3. メタデータ構築
  const vectorIds: string[] = [];
  const metadata: MemoryVectorMetadata[] = [];

  for (let i = 0; i < delta.facts.length; i++) {
    const fact = delta.facts[i];
    const vectorId = generateVectorId(
      delta.episodeId,
      delta.version,
      fact.scope,
      fact.characterId,
      i
    );
    vectorIds.push(vectorId);

    metadata.push({
      vectorId,
      episodeId: delta.episodeId,
      episodeNo: delta.episodeNo,
      version: delta.version,
      scope: fact.scope,
      characterId: fact.characterId || 'world',
      factIndex: i,
      text: fact.text,
      importance: fact.importance,
    });
  }

  // 4. S3Vectorsにupsert
  const store = createCharacterMemoryStore();
  const indexName = getIndexName(storyId);
  await ensureIndex(store, storyId);
  await store.upsert({
    indexName,
    vectors: embeddings,
    metadata,
    ids: vectorIds,
  });
  await store.disconnect();

  return {
    episodeId,
    episodeNo,
    version,
    factsCount: delta.facts.length,
    vectorIds,
  };
}

/**
 * エピソードの古いバージョンを削除
 */
export async function deleteEpisodeVectors(
  episodeId: string,
  version?: number
): Promise<void> {
  const store = createCharacterMemoryStore();

  // バージョン指定がある場合はそのバージョンのみ削除
  // ない場合はそのエピソードIDの全ベクトルを削除
  // S3Vectorsはfilter削除をサポートしているか確認が必要
  // 現時点ではvectorId単位での削除を想定

  await store.disconnect();
}
