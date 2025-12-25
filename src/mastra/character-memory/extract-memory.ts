/**
 * エピソードからキャラクターメモリ（差分）を抽出するツール
 *
 * LLMを使用してエピソードテキストから重要な事実を抽出し、
 * ワールド共通/キャラクター固有に分類する
 */
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateObject } from 'ai';
import { createBedrockModel } from '../../lib/bedrock-providers';
import type { CharacterId, EpisodeDelta, MemoryFact, ExtractedMemory } from './types';
import { CHARACTERS } from './types';

// 抽出に使用するモデル（Haiku: コスト効率が良い）
const extractModel = createBedrockModel('us.anthropic.claude-3-5-haiku-20241022-v1:0');

// キャラクターIDのリスト
const characterIds = Object.keys(CHARACTERS) as CharacterId[];

// キャラクター固有事実のスキーマ
const characterFactSchema = z.array(z.object({
  text: z.string().describe('そのキャラクターだけが知っている/経験した事実'),
  importance: z.number().min(1).max(5).describe('重要度（1-5、5が最重要）'),
})).optional().default([]);

// 抽出結果のスキーマ
const extractedMemorySchema = z.object({
  worldFacts: z.array(z.object({
    text: z.string().describe('ワールド共通の事実（全キャラクターが知り得る情報）'),
    importance: z.number().min(1).max(5).describe('重要度（1-5、5が最重要）'),
  })).describe('世界観や社会状況など、全キャラクター共通の事実'),
  characterFacts: z.object({
    'himuro-nigo': characterFactSchema.describe('氷室二郷の事実'),
    'genshin-tsubasa': characterFactSchema.describe('幻神翼の事実'),
    'kamishiro-rei': characterFactSchema.describe('神代零の事実'),
    'misaki': characterFactSchema.describe('美咲の事実'),
  }).describe('各キャラクター固有の事実（内心、行動、経験など）。登場しないキャラは空配列でOK'),
});

/**
 * エピソードテキストからメモリを抽出
 */
export async function extractMemoryFromEpisode(
  episodeText: string,
  episodeId: string,
  episodeNo: number,
  version: number = 1
): Promise<EpisodeDelta> {
  // キャラクター情報を含むプロンプト
  const characterInfo = characterIds
    .map(id => `- ${id}: ${CHARACTERS[id].name} - ${CHARACTERS[id].description}`)
    .join('\n');

  const systemPrompt = `あなたはストーリーから重要な事実を抽出するアシスタントです。

## キャラクター一覧
${characterInfo}

## タスク
以下のエピソードテキストから、キャラクターAIが「記憶」として持つべき重要な事実を抽出してください。

## 抽出ルール（重要：公開情報と秘密情報を正しく分類すること）

### 1. worldFacts（公開情報）
**他のキャラクターから見て分かる情報**をここに入れてください：
- 世界観、社会状況、ニュース
- キャラクターの外見、職業、公開の行動
- 人間関係（表向きのもの）
- 会話で共有された情報

**例：**
- 「異能力犯罪が社会問題になっている」（社会状況）
- 「翼はカフェ『ブルームーン』の店長」（職業＝誰でも知っている）
- 「二郷は高校生でカフェでバイトしている」（公開情報）
- 「零という女性がカフェに来た」（公開の出来事）

### 2. characterFacts（秘密情報）
**そのキャラクター本人だけが知っている情報**をここに入れてください：
- 内心、本音、感情
- 秘密の正体、隠された能力
- 他人に見せていない行動
- 本人しか知らない過去

**例：**
- 「二郷は時間停止能力を持っている」（秘密の能力→二郷だけが知る）
- 「翼は実は政府の監視者で二郷を監視している」（秘密の正体→翼だけが知る）
- 「二郷は犯罪者を消したことがある」（秘密の行動→二郷だけが知る）

⚠️ **重要な判断基準**：
- その情報は他のキャラクターが見て分かるか？ → worldFacts
- その情報は本人の頭の中だけにあるか？ → characterFacts

### 3. 重要度の基準
- 5: ストーリーの核心、キャラクターの本質
- 4: 重要な出来事、関係性
- 3: 日常的だが意味のある情報
- 2: 補足的な情報
- 1: 些細な情報

### 4. その他のルール
- 事実は簡潔に、1文で記述してください
- 未来の展開を示唆する情報は含めないでください（そのエピソード時点で確定した事実のみ）`;

  const { object } = await generateObject({
    model: extractModel,
    schema: extractedMemorySchema,
    system: systemPrompt,
    prompt: `以下のエピソード${episodeNo}から重要な事実を抽出してください：\n\n${episodeText}`,
  });

  // ExtractedMemory を EpisodeDelta に変換
  const facts: MemoryFact[] = [];

  // ワールド共通の事実
  for (const fact of object.worldFacts) {
    facts.push({
      text: fact.text,
      scope: 'world',
      importance: fact.importance,
    });
  }

  // キャラクター固有の事実
  for (const [charId, charFacts] of Object.entries(object.characterFacts)) {
    for (const fact of charFacts) {
      facts.push({
        text: fact.text,
        scope: 'character',
        characterId: charId as CharacterId,
        importance: fact.importance,
      });
    }
  }

  return {
    episodeId,
    episodeNo,
    version,
    facts,
    extractedAt: new Date(),
  };
}

/**
 * エピソード差分抽出ツール（エージェントから呼び出し可能）
 */
export const extractMemoryTool = createTool({
  id: 'extract-episode-memory',
  description: 'エピソードテキストから重要な事実（メモリ）を抽出します',
  inputSchema: z.object({
    episodeText: z.string().describe('エピソードのテキスト'),
    episodeId: z.string().describe('エピソードID（例: episode-1）'),
    episodeNo: z.number().describe('エピソード番号'),
    version: z.number().optional().default(1).describe('バージョン番号'),
  }),
  outputSchema: z.object({
    episodeId: z.string(),
    episodeNo: z.number(),
    version: z.number(),
    factsCount: z.number(),
    worldFactsCount: z.number(),
    characterFactsCount: z.number(),
  }),
  execute: async ({ context }) => {
    const delta = await extractMemoryFromEpisode(
      context.episodeText,
      context.episodeId,
      context.episodeNo,
      context.version
    );

    const worldFactsCount = delta.facts.filter(f => f.scope === 'world').length;
    const characterFactsCount = delta.facts.filter(f => f.scope === 'character').length;

    return {
      episodeId: delta.episodeId,
      episodeNo: delta.episodeNo,
      version: delta.version,
      factsCount: delta.facts.length,
      worldFactsCount,
      characterFactsCount,
    };
  },
});
