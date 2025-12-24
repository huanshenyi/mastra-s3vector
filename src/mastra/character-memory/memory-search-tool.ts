/**
 * キャラクターメモリRAG検索ツール
 *
 * 「未来を知らない」ルールを厳密に守り、
 * currentEpisodeNo - 1 までの記憶のみを検索する
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embedMany } from 'ai';
import { createBedrockEmbeddingModel } from '../../lib/bedrock-providers';
import {
  createCharacterMemoryStore,
  CHARACTER_MEMORY_INDEX,
} from './vector-store';
import type { CharacterId, MemoryQueryParams, MemorySearchResult, MemoryVectorMetadata } from './types';

// 埋め込みモデル
const embeddingModel = createBedrockEmbeddingModel('amazon.titan-embed-text-v2:0');

/**
 * キャラクターメモリを検索
 *
 * @param params 検索パラメータ
 * @returns 検索結果
 */
export async function searchCharacterMemory(
  params: MemoryQueryParams
): Promise<MemorySearchResult[]> {
  const { query, currentEpisodeNo, activeCharacterId, topK = 10 } = params;

  // cutoff: 現在のエピソード-1までの記憶を検索
  const cutoff = currentEpisodeNo - 1;

  if (cutoff < 1) {
    // エピソード1の場合、まだ記憶がない
    return [];
  }

  // クエリを埋め込み（embedManyを使用し、1件のみ取得）
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: [query],
  });
  const embedding = embeddings[0];

  // S3Vectorsで検索
  const store = createCharacterMemoryStore();

  // フィルタ条件:
  // - episodeNo <= cutoff（未来を知らない）
  // - scope == "world" OR (scope == "character" AND characterId == activeCharacterId)
  const filter = {
    $and: [
      { episodeNo: { $lte: cutoff } },
      {
        $or: [
          { scope: 'world' },
          {
            $and: [
              { scope: 'character' },
              { characterId: activeCharacterId },
            ],
          },
        ],
      },
    ],
  };

  const results = await store.query({
    indexName: CHARACTER_MEMORY_INDEX,
    queryVector: embedding,
    topK,
    filter,
    includeVector: false,
  });

  await store.disconnect();

  // 結果を変換
  return results.map(r => ({
    text: (r.metadata as MemoryVectorMetadata).text,
    score: r.score,
    metadata: r.metadata as MemoryVectorMetadata,
  }));
}

/**
 * キャラクターメモリ検索ツール（エージェントから呼び出し可能）
 */
export const characterMemorySearchTool = createTool({
  id: 'search-character-memory',
  description: `キャラクターの記憶を検索します。
現在のエピソード番号より前のエピソードで得た記憶のみを返します（未来の情報は含まれません）。
ワールド共通の記憶と、指定したキャラクター固有の記憶の両方を検索します。`,
  inputSchema: z.object({
    query: z.string().describe('検索クエリ（シーン説明、質問など）'),
    currentEpisodeNo: z.number().describe('現在のエピソード番号'),
    activeCharacterId: z.enum([
      'himuro-nigo',
      'genshin-tsubasa',
      'kamishiro-rei',
      'misaki',
    ]).describe('発話中のキャラクターID'),
    topK: z.number().optional().default(5).describe('取得する記憶の件数'),
  }),
  outputSchema: z.object({
    memories: z.array(z.object({
      text: z.string(),
      score: z.number(),
      episodeNo: z.number(),
      scope: z.string(),
      characterId: z.string(),
      importance: z.number(),
    })),
    count: z.number(),
  }),
  execute: async ({ context }) => {
    const results = await searchCharacterMemory({
      query: context.query,
      currentEpisodeNo: context.currentEpisodeNo,
      activeCharacterId: context.activeCharacterId as CharacterId,
      topK: context.topK,
    });

    return {
      memories: results.map(r => ({
        text: r.text,
        score: r.score,
        episodeNo: r.metadata.episodeNo,
        scope: r.metadata.scope,
        characterId: r.metadata.characterId,
        importance: r.metadata.importance,
      })),
      count: results.length,
    };
  },
});

/**
 * 特定エピソードまでの全記憶を取得（デバッグ用）
 */
export async function getAllMemoriesUpToEpisode(
  episodeNo: number,
  characterId?: CharacterId
): Promise<MemorySearchResult[]> {
  const store = createCharacterMemoryStore();

  // ダミーベクトルで検索（全件取得に近い形）
  // 実際にはインデックスサイズに制限があるため、topKを大きくする
  const dummyVector = new Array(1024).fill(0);

  // フィルター構築
  const filter = characterId
    ? {
        $and: [
          { episodeNo: { $lte: episodeNo } },
          {
            $or: [
              { scope: 'world' },
              { $and: [{ scope: 'character' }, { characterId }] },
            ],
          },
        ],
      }
    : {
        $and: [{ episodeNo: { $lte: episodeNo } }],
      };

  const results = await store.query({
    indexName: CHARACTER_MEMORY_INDEX,
    queryVector: dummyVector,
    topK: 100,
    filter,
    includeVector: false,
  });

  await store.disconnect();

  return results.map(r => ({
    text: (r.metadata as MemoryVectorMetadata).text,
    score: r.score,
    metadata: r.metadata as MemoryVectorMetadata,
  }));
}
