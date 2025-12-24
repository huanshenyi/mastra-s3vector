/**
 * キャラクターメモリ検索ツール
 *
 * RuntimeContextからcharacterIdとcurrentEpisodeNoを読み取り、
 * 自動でフィルタを生成・適用してベクトル検索を行う
 *
 * これにより：
 * - 二郷として検索 → 翼の秘密（政府の監視者）は返らない
 * - 翼として検索 → 翼の秘密は返る
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embedMany } from 'ai';
import { S3Vectors } from '@mastra/s3vectors';
import { createBedrockEmbeddingModel } from '../../lib/bedrock-providers';
import { createCharacterMemoryStore, CHARACTER_MEMORY_INDEX } from './vector-store';

// 埋め込みモデル
const embeddingModel = createBedrockEmbeddingModel('amazon.titan-embed-text-v2:0');

// 遅延初期化（循環参照回避）
let vectorStore: S3Vectors | null = null;
function getVectorStore(): S3Vectors {
  if (!vectorStore) {
    vectorStore = createCharacterMemoryStore();
  }
  return vectorStore;
}

/**
 * 「未来を知らない」＋「他キャラの秘密を知らない」フィルタを生成
 *
 * @param characterId キャラクターID
 * @param currentEpisodeNo 現在のエピソード番号
 * @returns S3Vectors用のフィルタオブジェクト
 */
export function createMemoryFilter(
  characterId: string,
  currentEpisodeNo: number
) {
  const cutoff = currentEpisodeNo - 1;

  if (cutoff < 1) {
    // エピソード1の場合、まだ記憶がない
    return null;
  }

  return {
    $and: [
      { episodeNo: { $lte: cutoff } },
      {
        $or: [
          { scope: 'world' },
          {
            $and: [
              { scope: 'character' },
              { characterId },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * キャラクターメモリ検索ツール
 *
 * RuntimeContextで以下を設定して使用：
 * - characterId: キャラクターID
 * - currentEpisodeNo: 現在のエピソード番号
 *
 * フィルタは自動生成され、そのキャラクターが知っている情報のみを返す
 */
export const characterMemoryQueryTool = createTool({
  id: 'recall-character-memory',
  description: `キャラクターの記憶を検索します。
RuntimeContextのcharacterIdに基づき、そのキャラだけが知っている情報を返します。
- scope: "world" の記憶は全員が知っている
- scope: "character" の記憶はそのキャラクターだけが知っている`,
  inputSchema: z.object({
    query: z.string().describe('思い出したい内容に関連するキーワードや質問'),
    topK: z.number().optional().default(5).describe('取得する記憶の最大件数'),
  }),
  outputSchema: z.object({
    memories: z.array(z.object({
      text: z.string(),
      episodeNo: z.number(),
      scope: z.string(),
      characterId: z.string().optional(),
      importance: z.number().optional(),
    })),
    count: z.number(),
    appliedFilter: z.any().optional(),
  }),
  execute: async ({ context, runtimeContext }) => {
    // RuntimeContextからキャラクター情報を取得
    const characterId = runtimeContext?.get('characterId') as string | undefined;
    const currentEpisodeNo = runtimeContext?.get('currentEpisodeNo') as number | undefined;

    if (!characterId || !currentEpisodeNo) {
      return {
        memories: [],
        count: 0,
        error: 'RuntimeContextにcharacterIdとcurrentEpisodeNoを設定してください',
      };
    }

    // フィルタを自動生成
    const filter = createMemoryFilter(characterId, currentEpisodeNo);

    if (!filter) {
      return {
        memories: [],
        count: 0,
        note: 'エピソード1の場合、まだ記憶がありません',
      };
    }

    // ベクトル検索
    const store = getVectorStore();
    const { embeddings } = await embedMany({
      model: embeddingModel,
      values: [context.query],
    });

    const results = await store.query({
      indexName: CHARACTER_MEMORY_INDEX,
      queryVector: embeddings[0],
      topK: context.topK ?? 10,
      filter,
    });

    return {
      memories: results.map(r => ({
        text: r.metadata?.text as string,
        episodeNo: r.metadata?.episodeNo as number,
        scope: r.metadata?.scope as string,
        characterId: r.metadata?.characterId as string | undefined,
        importance: r.metadata?.importance as number | undefined,
      })),
      count: results.length,
      appliedFilter: filter,
    };
  },
});
