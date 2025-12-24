# キャラクターメモリRAG

S3Vectorsを使用したキャラクターAIエージェントの思い出RAGシステム。

## 概要

このシステムは以下の機能を提供します：

1. **エピソード差分メモリ**: 各エピソードから重要な事実（facts）を抽出
2. **未来を知らないRAG**: 現在のエピソード-1までの記憶のみを検索
3. **キャラクター固有メモリ**: 公開情報/秘密情報を区別し、他キャラの秘密は見えない
4. **テンプレート化エージェント**: RuntimeContextで任意のキャラクターとして会話可能

## アーキテクチャ

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Episode.md    │────▶│  Extract Memory  │────▶│   S3 Vectors    │
│  (ストーリー)    │     │  (LLM差分抽出)    │     │  (ベクトルDB)    │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                                                          ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  User Message   │────▶│ Character Agent  │◀────│  Memory Search  │
│  (ユーザー入力)  │     │  (キャラクター)   │     │  (RAG検索)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## 記憶の分類ルール

### 公開情報（worldFacts）→ 全員が見える
他のキャラクターから見て分かる情報：
- 世界観、社会状況、ニュース
- キャラクターの外見、職業、公開の行動
- 例：「翼はカフェ『ブルームーン』の店長」「二郷は高校生」

### 秘密情報（characterFacts）→ 本人だけが見える
そのキャラクター本人だけが知っている情報：
- 内心、本音、感情
- 秘密の正体、隠された能力
- 例：「翼は実は政府の監視者」「二郷は時間停止能力を持つ」

| 事実 | scope | characterId | 誰が見える？ |
|------|-------|-------------|-------------|
| 翼はカフェ店長 | `world` | - | 全員 |
| 翼は政府の監視者 | `character` | `genshin-tsubasa` | 翼のみ |
| 二郷は高校生 | `world` | - | 全員 |
| 二郷は時間停止能力を持つ | `character` | `himuro-nigo` | 二郷のみ |

## メタデータ設計

各ベクトルに以下のメタデータを保存：

| フィールド    | 説明                                          |
|--------------|-----------------------------------------------|
| `vectorId`   | 決め打ちID: `vec:{episodeId}:v{version}:{scope}:{characterId}:{factIndex}` |
| `episodeId`  | エピソードID（例: `episode-1`）                |
| `episodeNo`  | エピソード番号（1, 2, 3...）                   |
| `version`    | バージョン（更新時にインクリメント）            |
| `scope`      | `world`（公開）or `character`（秘密）          |
| `characterId`| キャラクターID（scope=characterの場合）         |
| `factIndex`  | 事実のインデックス                             |
| `text`       | 事実のテキスト                                 |
| `importance` | 重要度（1-5）                                  |

## 使い方

### 環境変数設定

```bash
# .envファイルに設定
S3_VECTORS_BUCKET_NAME="your-vector-bucket"
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
```

### エピソードのIngest

```bash
# 全エピソードをIngest
npx tsx scripts/ingest-episodes.ts

# 特定のエピソードのみ
npx tsx scripts/ingest-episodes.ts --episode 1
```

### Mastra Studioでテスト（推奨）

```bash
npm run dev
```

1. ブラウザで http://localhost:4111 を開く
2. **Agents** → **characterAgent** を選択
3. **Runtime Context** を設定：
   - `characterId`: `"himuro-nigo"`（または他のキャラクターID）
   - `currentEpisodeNo`: `3`
4. メッセージを入力して会話開始

> **Note**: フィルタは自動適用されます。RuntimeContextに`characterId`と`currentEpisodeNo`を設定するだけでOKです。

### コードからの使用

```typescript
import { RuntimeContext } from '@mastra/core/runtime-context';
import { mastra } from './src/mastra';

// RuntimeContextを作成
const runtimeContext = new RuntimeContext();
runtimeContext.set('characterId', 'himuro-nigo');
runtimeContext.set('currentEpisodeNo', 3);

// エージェントを取得して会話
const agent = mastra.getAgent('characterAgent');
const response = await agent.generate('翼さんってどんな人？', { runtimeContext });
console.log(response.text);

// 期待結果：
// - 「カフェ店長」の情報は返る（公開情報）
// - 「政府の監視者」は返らない（翼だけが知っている秘密）
```

## キャラクター一覧

| ID               | 名前     | 説明                                    |
|------------------|----------|----------------------------------------|
| himuro-nigo      | 氷室二郷  | 時間停止能力を持つ高校生、主人公         |
| genshin-tsubasa  | 幻神翼   | カフェ店長、（秘密：政府の監視者）        |
| kamishiro-rei    | 神代零   | 謎の女性、組織に二郷を引き入れたい        |
| misaki           | 美咲     | 二郷の妹                                |

## 「未来を知らない」＋「他キャラの秘密を知らない」ルール

RAG検索時に自動適用されるフィルタ：

```typescript
{
  $and: [
    { episodeNo: { $lte: currentEpisodeNo - 1 } },  // 未来を知らない
    {
      $or: [
        { scope: 'world' },  // 公開情報は全員見える
        {
          $and: [
            { scope: 'character' },
            { characterId: activeCharacterId },  // 自分の秘密のみ見える
          ],
        },
      ],
    },
  ],
}
```

## ファイル構成

```
src/mastra/character-memory/
├── index.ts              # エクスポート
├── types.ts              # 型定義
├── vector-store.ts       # S3Vectors初期化
├── extract-memory.ts     # エピソード差分抽出（LLM使用）
├── ingest-workflow.ts    # Ingestワークフロー
├── memory-search-tool.ts # RAG検索ツール（直接検索）
├── memory-query-tool.ts  # RAG検索ツール（RuntimeContext対応、フィルタ自動適用）
└── character-agent.ts    # キャラクターエージェント

scripts/
├── ingest-episodes.ts    # Ingestスクリプト
└── demo-character-chat.ts # デモスクリプト

docs/
├── CHARACTER_MEMORY_RAG.md    # このドキュメント
├── EPISODE_SYNC_DESIGN.md     # 同期システム設計
└── character_memory/
    ├── 1.md                   # エピソード1
    └── 2.md                   # エピソード2
```

## 関連ドキュメント

- [エピソード同期システム設計](./EPISODE_SYNC_DESIGN.md) - DB連携・自動同期の設計
