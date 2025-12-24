/**
 * テンプレート化されたキャラクターエージェント
 *
 * どのキャラクターにも成り切れるよう、characterIdをパラメータとして受け取り、
 * そのキャラクターの思い出をRAGから取り出して応答する
 *
 * 2つの使い方をサポート：
 * 1. createCharacterAgent(characterId, episodeNo) - ファクトリー関数形式
 * 2. characterAgent + RuntimeContext - RuntimeContext形式（Mastra Studio対応）
 */
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createBedrockModel } from '../../lib/bedrock-providers';
import { characterMemorySearchTool, searchCharacterMemory } from './memory-search-tool';
import { characterMemoryQueryTool, createMemoryFilter } from './memory-query-tool';
import type { CharacterId, MemorySearchResult } from './types';
import { CHARACTERS } from './types';

// エージェントに使用するモデル
const agentModel = createBedrockModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0');

/**
 * キャラクター固有の指示を生成
 */
function generateCharacterInstructions(characterId: CharacterId): string {
  const char = CHARACTERS[characterId];

  const baseInstructions = `あなたは「${char.name}」というキャラクターとして振る舞います。

## キャラクター設定
${char.description}

## ロールプレイのルール
1. 常に${char.name}として一人称で話してください
2. キャラクターの性格・口調を一貫して維持してください
3. 検索した記憶（memories）を参考に、そのキャラクターが知っている情報のみを使って応答してください
4. 未来の出来事や、まだ起きていないことは知らないものとして振る舞ってください
5. 他のキャラクターしか知らない秘密は知らないものとして振る舞ってください

## 記憶の使い方
- search-character-memoryツールで検索した記憶は、あなたが過去に経験・認知した事実です
- scope: "world" の記憶は世界共通の情報（誰でも知っている）
- scope: "character" の記憶はあなただけが知っている情報
- 記憶にない情報については「覚えていない」「知らない」と答えてください`;

  // キャラクター固有の追加指示
  const characterSpecificInstructions: Record<CharacterId, string> = {
    'himuro-nigo': `
## 二郷の口調・性格
- 基本的に穏やかで礼儀正しい
- 内心では冷静に分析している
- 能力のことは絶対に明かさない
- 「普通」であることを大切にしている
- 一人称は「俺」または「僕」`,

    'genshin-tsubasa': `
## 翼の口調・性格
- 表向きは優しいカフェ店長
- 二郷に対しては先輩として接する
- 内心では任務として監視している葛藤がある
- 一人称は「俺」`,

    'kamishiro-rei': `
## 零の口調・性格
- 落ち着いた大人の女性
- 知的で洞察力が鋭い
- 自分の目的のために動いている
- 一人称は「私」`,

    'misaki': `
## 美咲の口調・性格
- 明るく元気な妹
- 兄（二郷）のことが大好き
- 一人称は「私」または「あたし」`,
  };

  return baseInstructions + (characterSpecificInstructions[characterId] || '');
}

/**
 * キャラクターエージェントを作成
 *
 * @param characterId キャラクターID
 * @param currentEpisodeNo 現在のエピソード番号（この番号-1までの記憶を使用）
 */
export function createCharacterAgent(
  characterId: CharacterId,
  currentEpisodeNo: number
): Agent {
  const char = CHARACTERS[characterId];

  // このエージェント用にカスタマイズされた記憶検索ツール
  const boundMemorySearchTool = createTool({
    id: 'recall-memory',
    description: `あなた（${char.name}）の記憶を検索します。過去に経験・認知した事実を思い出すために使ってください。`,
    inputSchema: z.object({
      query: z.string().describe('思い出したい内容に関連するキーワードや質問'),
      topK: z.number().optional().default(5).describe('思い出す記憶の件数'),
    }),
    outputSchema: z.object({
      memories: z.array(z.object({
        text: z.string(),
        episodeNo: z.number(),
        importance: z.number(),
      })),
      count: z.number(),
    }),
    execute: async ({ context }) => {
      const results = await searchCharacterMemory({
        query: context.query,
        currentEpisodeNo,
        activeCharacterId: characterId,
        topK: context.topK,
      });

      return {
        memories: results.map(r => ({
          text: r.text,
          episodeNo: r.metadata.episodeNo,
          importance: r.metadata.importance,
        })),
        count: results.length,
      };
    },
  });

  return new Agent({
    name: `character-${characterId}`,
    model: agentModel,
    instructions: generateCharacterInstructions(characterId),
    tools: {
      recallMemory: boundMemorySearchTool,
    },
  });
}

/**
 * キャラクターエージェントファクトリー
 *
 * RuntimeContextを使用して動的にキャラクターを切り替える場合に使用
 */
export const characterAgentFactory = {
  /**
   * 利用可能なキャラクターIDのリスト
   */
  availableCharacters: Object.keys(CHARACTERS) as CharacterId[],

  /**
   * キャラクター情報を取得
   */
  getCharacterInfo(characterId: CharacterId) {
    return CHARACTERS[characterId];
  },

  /**
   * エージェントを作成
   */
  create(characterId: CharacterId, currentEpisodeNo: number) {
    return createCharacterAgent(characterId, currentEpisodeNo);
  },
};

/**
 * キャラクターとして会話するツール（他のエージェントから呼び出し可能）
 */
export const talkAsCharacterTool = createTool({
  id: 'talk-as-character',
  description: '指定したキャラクターとして会話します',
  inputSchema: z.object({
    characterId: z.enum([
      'himuro-nigo',
      'genshin-tsubasa',
      'kamishiro-rei',
      'misaki',
    ]).describe('キャラクターID'),
    currentEpisodeNo: z.number().describe('現在のエピソード番号'),
    userMessage: z.string().describe('ユーザーからのメッセージ'),
  }),
  outputSchema: z.object({
    characterName: z.string(),
    response: z.string(),
  }),
  execute: async ({ context }) => {
    const agent = createCharacterAgent(
      context.characterId as CharacterId,
      context.currentEpisodeNo
    );

    const result = await agent.generate(context.userMessage);

    return {
      characterName: CHARACTERS[context.characterId as CharacterId].name,
      response: result.text,
    };
  },
});

// ============================================================
// RuntimeContext形式のキャラクターエージェント
// ============================================================

/**
 * RuntimeContext型定義
 *
 * Mastra Studioやエージェント呼び出し時に設定する値
 */
export type CharacterRuntimeContext = {
  /** キャラクターID */
  characterId: CharacterId;
  /** 現在のエピソード番号（この番号-1までの記憶を使用） */
  currentEpisodeNo: number;
};

/**
 * RuntimeContext対応キャラクターエージェント
 *
 * RuntimeContextでcharacterIdとcurrentEpisodeNoを設定して使用する
 *
 * 使用例（コード）：
 * ```typescript
 * import { RuntimeContext } from '@mastra/core/runtime-context';
 *
 * const runtimeContext = new RuntimeContext<CharacterRuntimeContext>();
 * runtimeContext.set('characterId', 'himuro-nigo');
 * runtimeContext.set('currentEpisodeNo', 2);
 *
 * // フィルター設定（未来を知らないルール）
 * const filter = createMemoryFilter('himuro-nigo', 2);
 * runtimeContext.set('filter', filter);
 *
 * const agent = mastra.getAgent('characterAgent');
 * const response = await agent.generate('今日のバイトはどうだった？', { runtimeContext });
 * ```
 *
 * 使用例（Mastra Studio）：
 * 1. Agents → characterAgent を選択
 * 2. Runtime Contextを設定：
 *    - characterId: "himuro-nigo"
 *    - currentEpisodeNo: 2
 *    - filter: { "$and": [{ "episodeNo": { "$lte": 1 } }, ...] }
 * 3. メッセージを送信
 */
export const characterAgent = new Agent({
  name: 'character-agent',

  // RuntimeContextからキャラクター情報を取得して指示を動的生成
  instructions: async ({ runtimeContext }) => {
    const characterId = runtimeContext?.get('characterId') as CharacterId | undefined;

    if (!characterId || !CHARACTERS[characterId]) {
      return `あなたはキャラクターAIアシスタントです。
RuntimeContextで characterId を設定してください。

利用可能なキャラクター:
${Object.entries(CHARACTERS).map(([id, char]) => `- ${id}: ${char.name}`).join('\n')}

例: runtimeContext.set('characterId', 'himuro-nigo')`;
    }

    return generateCharacterInstructions(characterId);
  },

  model: agentModel,

  tools: {
    recallMemory: characterMemoryQueryTool,
  },
});
