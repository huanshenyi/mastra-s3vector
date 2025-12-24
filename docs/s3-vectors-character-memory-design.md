# Amazon S3 Vectors - キャラクター記憶システム設計レポート

## 目次
1. [Amazon S3 Vectors 価格体系](#1-amazon-s3-vectors-価格体系)
2. [インデックス設計の基本概念](#2-インデックス設計の基本概念)
3. [キャラクター記憶システムのアーキテクチャ](#3-キャラクター記憶システムのアーキテクチャ)
4. [実装設計](#4-実装設計)
5. [コスト試算](#5-コスト試算)
6. [運用ガイドライン](#6-運用ガイドライン)

---

## 1. Amazon S3 Vectors 価格体系

### 1.1 基本料金（US East N. Virginia基準）

| 項目 | 料金 | 備考 |
|-----|------|------|
| **ストレージ** | $0.06/GB/月 | 最初の50TB |
| **PUT（アップロード）** | $0.20/GB | 論理データサイズ |
| **クエリAPI呼び出し** | $2.50/100万クエリ | - |
| **クエリデータ処理（Tier 1）** | $0.004/TB | 最初の10万ベクトル |
| **クエリデータ処理（Tier 2）** | $0.002/TB | 10万ベクトル以上 |

### 1.2 データサイズの計算

```
ベクトル1個のサイズ = ベクトルデータ + メタデータ + キー

例: 1024次元のベクトル
- ベクトルデータ: 1024次元 × 4 bytes = 4 KB
- フィルタ可能メタデータ: 最大 2 KB
- 非フィルタ可能メタデータ: 最大 38 KB
- キー: 1 byte/文字（最大1,024文字）

典型的なサイズ: 6-8 KB/ベクトル
```

### 1.3 クエリコストの詳細

**クエリコスト = API呼び出し料金 + データ処理料金**

データ処理料金の計算：
```
処理データサイズ = (ベクトルデータ + キー + フィルタ可能メタデータ) × インデックス内ベクトル数
```

**重要**: 非フィルタ可能メタデータは処理コストに含まれない（無料で返却可能）

### 1.4 従来のベクトルDBとの比較

| 項目 | 従来のベクトルDB | S3 Vectors |
|-----|---------------|------------|
| **料金体系** | コンピュート + ストレージ + API | ストレージ + クエリ従量課金 |
| **スケール時の費用** | 指数関数的に増加 | 線形的に増加 |
| **容量計画** | 事前のキャパシティプランニング必要 | サーバーレス、自動スケール |
| **コスト削減率** | - | 最大90%削減 |
| **適用シーン** | リアルタイム検索（<100ms） | バッチ処理・RAG（<1秒） |

---

## 2. インデックス設計の基本概念

### 2.1 階層構造

```
AWS Account
└── Vector Bucket（最大10,000/リージョン）
    └── Vector Index（最大10,000/バケット）
        └── Vector（最大50,000,000/インデックス）
```

### 2.2 インデックス作成時の必須パラメータ（後から変更不可）

#### 2.2.1 次元数（Dimension）
- **範囲**: 1〜4,096
- **制約**: インデックス内の全ベクトルが同じ次元数
- **選択基準**: 使用する埋め込みモデルで決定

```
一般的な埋め込みモデル:
- OpenAI text-embedding-3-small: 1536次元
- OpenAI text-embedding-3-large: 3072次元
- Amazon Titan Embeddings V2: 1024次元
- Cohere Embed v3: 1024次元
```

#### 2.2.2 距離メトリック（Distance Metric）

| メトリック | 計算方法 | 適用場面 | 用途例 |
|----------|---------|---------|--------|
| **Cosine** | ベクトル間の角度 | 方向性重視 | テキスト埋め込み、RAG、推薦 |
| **Euclidean** | 直線距離 | 方向と大きさ両方 | 画像特徴、数値データ |

#### 2.2.3 非フィルタ可能メタデータキー
- **最大10個/インデックス**
- **用途**: 検索には使わないが結果に含めたい大きなデータ
- **例**: 元テキスト、詳細説明、ソースURL

### 2.3 インデックス分割戦略の重要性

**なぜインデックスを分割するのか？**

```typescript
// ❌ 悪い例: 全データを1つのインデックスに
const singleIndex = {
  vectors: 10_000_000,
  queryTime: '毎回1000万ベクトル検索',
  queryCost: '高額',
  isolation: '文脈が混在'
};

// ✅ 良い例: 論理的に分割
const multipleIndexes = {
  perIndex: 50_000,
  queryTime: '必要なインデックスのみ検索',
  queryCost: '200分の1',
  isolation: '文脈が分離'
};
```

**コスト削減効果**:
- 検索対象ベクトル数が200分の1 → クエリコストが約200分の1

---

## 3. キャラクター記憶システムのアーキテクチャ

### 3.1 設計思想：キャラクター中心のメモリ管理

従来のストーリー中心ではなく、**キャラクターの記憶**として情報を管理。

```
キャラクターの視点:
- 私（キャラクター）はどのストーリーに登場したか？
- 各ストーリーで何をしたか？
- 誰と出会い、どんな関係を築いたか？
- 時系列でどのように成長・変化したか？
```

### 3.2 2層インデックス構造

#### レイヤー1: ストーリーインデックス（文脈分離）
#### レイヤー2: キャラクターメモリインデックス（横断検索）

```
vector-bucket/
├── story-indexes/              # レイヤー1: ストーリーごとの詳細記憶
│   ├── story-001-memories/     # ストーリー001のすべての記憶
│   ├── story-002-memories/     # ストーリー002のすべての記憶
│   └── story-003-memories/
│
└── character-indexes/          # レイヤー2: キャラクター横断検索
    ├── character-alice-timeline/   # Aliceのすべてのストーリーでの記憶
    ├── character-bob-timeline/     # Bobのすべてのストーリーでの記憶
    └── character-carol-timeline/
```

### 3.3 データモデル

#### 3.3.1 ストーリーインデックス（詳細記憶）

```typescript
interface StoryMemory {
  // ベクトルキー
  key: string;  // "story-001_scene-12_alice-action"

  // ベクトルデータ（埋め込み）
  vector: number[];  // 1024次元

  // フィルタ可能メタデータ（検索・フィルタリング用）
  metadata: {
    storyId: string;           // "story-001"
    sceneId: string;           // "scene-12"
    characterId: string;       // "alice"
    characterName: string;     // "Alice"
    eventType: 'action' | 'dialogue' | 'thought' | 'relationship';
    timestamp: number;         // シーン内のタイムスタンプ
    relatedCharacters: string[]; // ["bob", "carol"]
    relationshipType?: string; // "friend", "rival", "family"
    emotionalTone: string;     // "happy", "sad", "angry"
    importance: number;        // 1-10（重要度）
  };

  // 非フィルタ可能メタデータ（結果表示用）
  nonFilterableMetadata: {
    originalText: string;      // 元テキスト（長文OK）
    fullDescription: string;   // 詳細説明
    context: string;           // 前後の文脈
    chapterTitle: string;      // 章タイトル
  };
}
```

#### 3.3.2 キャラクタータイムラインインデックス（横断記憶）

```typescript
interface CharacterTimelineMemory {
  // ベクトルキー
  key: string;  // "alice_story-001_event-025"

  // ベクトルデータ
  vector: number[];  // 1024次元

  // フィルタ可能メタデータ
  metadata: {
    characterId: string;       // "alice"
    storyId: string;           // "story-001"
    storyTitle: string;        // "The Great Adventure"
    eventSequence: number;     // グローバル時系列番号
    storySequence: number;     // ストーリー内の順番
    eventType: 'first_appearance' | 'key_action' | 'relationship_change' | 'growth';
    phase: 'beginning' | 'middle' | 'end';
    relatedCharacters: string[];
    relationshipChanges: boolean; // 関係性の変化があったか
    characterGrowth: boolean;     // 成長イベントか
  };

  // 非フィルタ可能メタデータ
  nonFilterableMetadata: {
    summary: string;           // イベント要約
    impact: string;            // キャラクターへの影響
    quote: string;             // 代表的なセリフ
    beforeState: string;       // このイベント前の状態
    afterState: string;        // このイベント後の状態
  };
}
```

### 3.4 インデックス命名規則

```typescript
// ストーリーインデックス
const storyIndexName = `story-${storyId}-memories`;

// キャラクタータイムラインインデックス
const characterIndexName = `character-${characterId}-timeline`;

// 関係性専用インデックス（オプション）
const relationshipIndexName = `relationship-${char1Id}-${char2Id}`;

// 時期別インデックス（大規模システム向け）
const timelinePhaseIndexName = `character-${characterId}-phase-${phase}`;
```

### 3.5 検索パターン

#### パターン1: ストーリー内でのキャラクター検索
```typescript
// "ストーリー001でAliceが怒っている場面を探す"
searchInStory({
  indexName: 'story-001-memories',
  query: 'Aliceが怒っている',
  filter: {
    characterId: 'alice',
    emotionalTone: 'angry'
  }
});
```

#### パターン2: キャラクターの時系列記憶検索
```typescript
// "Aliceがこれまでに経験した成長イベントを時系列で取得"
searchCharacterTimeline({
  indexName: 'character-alice-timeline',
  query: '成長と変化',
  filter: {
    characterGrowth: true
  },
  sortBy: 'eventSequence'
});
```

#### パターン3: 複数ストーリー横断検索
```typescript
// "AliceがBobと出会った場面をすべてのストーリーから探す"
searchAcrossStories({
  characterIndexName: 'character-alice-timeline',
  query: 'Bobとの出会い',
  filter: {
    relatedCharacters: ['bob'],
    eventType: 'relationship_change'
  }
});
```

#### パターン4: 関係性の変遷追跡
```typescript
// "AliceとBobの関係がどう変化したか時系列で取得"
trackRelationship({
  characterIndexName: 'character-alice-timeline',
  query: 'Bobとの関係',
  filter: {
    relatedCharacters: ['bob'],
    relationshipChanges: true
  },
  sortBy: 'eventSequence'
});
```

---

## 4. 実装設計

### 4.1 システム構成図

```
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
├─────────────────────────────────────────────────────────┤
│  StoryService  │  CharacterService  │  SearchService    │
└────────┬────────────────┬─────────────────┬─────────────┘
         │                │                 │
         ▼                ▼                 ▼
┌─────────────────────────────────────────────────────────┐
│              CharacterMemoryService                      │
│  - createStoryIndex()                                    │
│  - createCharacterTimeline()                             │
│  - addMemoryToStory()                                    │
│  - addMemoryToTimeline()                                 │
│  - searchInStory()                                       │
│  - searchCharacterTimeline()                             │
└────────┬────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│                   S3 Vectors API                         │
│  - CreateIndex                                           │
│  - PutVectors                                            │
│  - QueryVectors                                          │
│  - ListVectors                                           │
│  - DeleteVectors                                         │
└─────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              Amazon S3 Vector Bucket                     │
│                                                          │
│  ├── story-indexes/                                      │
│  │   ├── story-001-memories/ (50K vectors)              │
│  │   ├── story-002-memories/ (30K vectors)              │
│  │   └── ...                                            │
│  │                                                       │
│  └── character-indexes/                                  │
│      ├── character-alice-timeline/ (500 vectors)         │
│      ├── character-bob-timeline/ (300 vectors)           │
│      └── ...                                            │
└─────────────────────────────────────────────────────────┘
```

### 4.2 コアサービス実装

```typescript
// services/character-memory-service.ts

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { S3VectorsClient } from '@aws-sdk/client-s3-vectors'; // 仮想的なSDK
import { logger } from '@/utils/logger';

interface CreateStoryIndexParams {
  storyId: string;
  storyTitle: string;
  metadata?: {
    author?: string;
    genre?: string;
    publishedDate?: string;
  };
}

interface AddMemoryParams {
  storyId: string;
  characterId: string;
  characterName: string;
  sceneId: string;
  eventType: 'action' | 'dialogue' | 'thought' | 'relationship';
  content: string;
  context?: string;
  relatedCharacters?: string[];
  emotionalTone?: string;
  importance?: number;
}

export class CharacterMemoryService {
  private s3Vectors: S3VectorsClient;
  private bedrock: BedrockRuntimeClient;
  private bucketName = 'character-memory-vectors';
  private embeddingModel = 'amazon.titan-embed-text-v2:0';

  constructor() {
    this.s3Vectors = new S3VectorsClient({ region: 'us-west-2' });
    this.bedrock = new BedrockRuntimeClient({ region: 'us-west-2' });
  }

  /**
   * ストーリー用のインデックスを作成
   */
  async createStoryIndex(params: CreateStoryIndexParams): Promise<string> {
    const indexName = `story-${params.storyId}-memories`;

    logger.info(`📚 ストーリーインデックス作成開始: ${indexName}`);

    await this.s3Vectors.createIndex({
      bucketName: this.bucketName,
      indexName,
      dimension: 1024,
      distanceMetric: 'Cosine',
      nonFilterableMetadataKeys: [
        'originalText',
        'fullDescription',
        'context',
        'chapterTitle'
      ]
    });

    logger.info(`✅ ストーリーインデックス作成完了: ${indexName}`);
    return indexName;
  }

  /**
   * キャラクタータイムライン用のインデックスを作成
   */
  async createCharacterTimeline(
    characterId: string,
    characterName: string
  ): Promise<string> {
    const indexName = `character-${characterId}-timeline`;

    logger.info(`👤 キャラクタータイムライン作成開始: ${characterName}`);

    await this.s3Vectors.createIndex({
      bucketName: this.bucketName,
      indexName,
      dimension: 1024,
      distanceMetric: 'Cosine',
      nonFilterableMetadataKeys: [
        'summary',
        'impact',
        'quote',
        'beforeState',
        'afterState'
      ]
    });

    logger.info(`✅ キャラクタータイムライン作成完了: ${characterName}`);
    return indexName;
  }

  /**
   * ストーリーインデックスに記憶を追加
   */
  async addMemoryToStory(params: AddMemoryParams): Promise<void> {
    const storyIndexName = `story-${params.storyId}-memories`;

    // テキストをベクトル化
    const vector = await this.embedText(params.content);

    // ベクトルキーを生成
    const vectorKey = `story-${params.storyId}_scene-${params.sceneId}_${params.characterId}-${params.eventType}`;

    // ストーリーインデックスに追加
    await this.s3Vectors.putVectors({
      bucketName: this.bucketName,
      indexName: storyIndexName,
      vectors: [{
        key: vectorKey,
        data: vector,
        metadata: {
          storyId: params.storyId,
          sceneId: params.sceneId,
          characterId: params.characterId,
          characterName: params.characterName,
          eventType: params.eventType,
          timestamp: Date.now(),
          relatedCharacters: params.relatedCharacters || [],
          emotionalTone: params.emotionalTone || 'neutral',
          importance: params.importance || 5
        },
        nonFilterableMetadata: {
          originalText: params.content,
          fullDescription: `${params.characterName}: ${params.content}`,
          context: params.context || '',
          chapterTitle: `Scene ${params.sceneId}`
        }
      }]
    });

    logger.info(`💾 記憶追加完了: ${vectorKey}`);
  }

  /**
   * キャラクタータイムラインに記憶を追加
   */
  async addMemoryToTimeline(params: {
    characterId: string;
    storyId: string;
    storyTitle: string;
    eventSequence: number;
    storySequence: number;
    eventType: 'first_appearance' | 'key_action' | 'relationship_change' | 'growth';
    phase: 'beginning' | 'middle' | 'end';
    summary: string;
    impact?: string;
    relatedCharacters?: string[];
  }): Promise<void> {
    const timelineIndexName = `character-${params.characterId}-timeline`;

    // 要約をベクトル化
    const vector = await this.embedText(params.summary);

    // ベクトルキーを生成
    const vectorKey = `${params.characterId}_story-${params.storyId}_event-${params.eventSequence}`;

    await this.s3Vectors.putVectors({
      bucketName: this.bucketName,
      indexName: timelineIndexName,
      vectors: [{
        key: vectorKey,
        data: vector,
        metadata: {
          characterId: params.characterId,
          storyId: params.storyId,
          storyTitle: params.storyTitle,
          eventSequence: params.eventSequence,
          storySequence: params.storySequence,
          eventType: params.eventType,
          phase: params.phase,
          relatedCharacters: params.relatedCharacters || [],
          relationshipChanges: params.eventType === 'relationship_change',
          characterGrowth: params.eventType === 'growth'
        },
        nonFilterableMetadata: {
          summary: params.summary,
          impact: params.impact || '',
          quote: '',
          beforeState: '',
          afterState: ''
        }
      }]
    });

    logger.info(`📅 タイムライン記憶追加: ${vectorKey}`);
  }

  /**
   * ストーリー内で記憶を検索
   */
  async searchInStory(params: {
    storyId: string;
    query: string;
    characterId?: string;
    eventType?: string;
    emotionalTone?: string;
    topK?: number;
  }): Promise<any[]> {
    const storyIndexName = `story-${params.storyId}-memories`;
    const queryVector = await this.embedText(params.query);

    // フィルタ条件構築
    const filters = [];
    if (params.characterId) {
      filters.push(`characterId = '${params.characterId}'`);
    }
    if (params.eventType) {
      filters.push(`eventType = '${params.eventType}'`);
    }
    if (params.emotionalTone) {
      filters.push(`emotionalTone = '${params.emotionalTone}'`);
    }

    const results = await this.s3Vectors.queryVectors({
      bucketName: this.bucketName,
      indexName: storyIndexName,
      queryVector,
      topK: params.topK || 10,
      metadataFilter: filters.join(' AND ') || undefined
    });

    logger.info(`🔍 ストーリー内検索完了: ${results.length}件`);
    return results;
  }

  /**
   * キャラクターのタイムライン検索
   */
  async searchCharacterTimeline(params: {
    characterId: string;
    query: string;
    storyId?: string;
    eventType?: string;
    phase?: string;
    topK?: number;
  }): Promise<any[]> {
    const timelineIndexName = `character-${params.characterId}-timeline`;
    const queryVector = await this.embedText(params.query);

    // フィルタ条件構築
    const filters = [];
    if (params.storyId) {
      filters.push(`storyId = '${params.storyId}'`);
    }
    if (params.eventType) {
      filters.push(`eventType = '${params.eventType}'`);
    }
    if (params.phase) {
      filters.push(`phase = '${params.phase}'`);
    }

    const results = await this.s3Vectors.queryVectors({
      bucketName: this.bucketName,
      indexName: timelineIndexName,
      queryVector,
      topK: params.topK || 20,
      metadataFilter: filters.join(' AND ') || undefined
    });

    // 時系列でソート
    results.sort((a, b) => a.metadata.eventSequence - b.metadata.eventSequence);

    logger.info(`📅 タイムライン検索完了: ${results.length}件`);
    return results;
  }

  /**
   * 複数ストーリーにまたがる記憶検索
   */
  async searchAcrossStories(params: {
    characterId: string;
    query: string;
    relatedCharacter?: string;
    eventType?: string;
  }): Promise<Map<string, any[]>> {
    const timelineIndexName = `character-${params.characterId}-timeline`;
    const queryVector = await this.embedText(params.query);

    // フィルタ条件
    const filters = [];
    if (params.relatedCharacter) {
      filters.push(`relatedCharacters CONTAINS '${params.relatedCharacter}'`);
    }
    if (params.eventType) {
      filters.push(`eventType = '${params.eventType}'`);
    }

    // タイムラインから該当イベントを取得
    const timelineResults = await this.s3Vectors.queryVectors({
      bucketName: this.bucketName,
      indexName: timelineIndexName,
      queryVector,
      topK: 50,
      metadataFilter: filters.join(' AND ') || undefined
    });

    // ストーリーIDごとにグループ化
    const resultsByStory = new Map<string, any[]>();

    for (const result of timelineResults) {
      const storyId = result.metadata.storyId;
      if (!resultsByStory.has(storyId)) {
        resultsByStory.set(storyId, []);
      }
      resultsByStory.get(storyId)!.push(result);
    }

    logger.info(`🌐 横断検索完了: ${resultsByStory.size}ストーリー`);
    return resultsByStory;
  }

  /**
   * 関係性の変遷を追跡
   */
  async trackRelationship(params: {
    characterId: string;
    relatedCharacterId: string;
    query?: string;
  }): Promise<any[]> {
    const timelineIndexName = `character-${params.characterId}-timeline`;
    const query = params.query || `${params.relatedCharacterId}との関係`;
    const queryVector = await this.embedText(query);

    const results = await this.s3Vectors.queryVectors({
      bucketName: this.bucketName,
      indexName: timelineIndexName,
      queryVector,
      topK: 100,
      metadataFilter: `relatedCharacters CONTAINS '${params.relatedCharacterId}' AND relationshipChanges = true`
    });

    // 時系列でソート
    results.sort((a, b) => a.metadata.eventSequence - b.metadata.eventSequence);

    logger.info(`💑 関係性追跡完了: ${results.length}件の変化`);
    return results;
  }

  /**
   * テキストをベクトルに変換
   */
  private async embedText(text: string): Promise<number[]> {
    const input = {
      modelId: this.embeddingModel,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text
      })
    };

    const command = new InvokeModelCommand(input);
    const response = await this.bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    return responseBody.embedding;
  }
}
```

### 4.3 使用例

```typescript
// 例1: 新しいストーリー開始
const memoryService = new CharacterMemoryService();

// ストーリーインデックス作成
await memoryService.createStoryIndex({
  storyId: 'adventure-001',
  storyTitle: 'The Great Adventure'
});

// キャラクタータイムライン作成
await memoryService.createCharacterTimeline('alice', 'Alice');
await memoryService.createCharacterTimeline('bob', 'Bob');

// 例2: 記憶の追加
await memoryService.addMemoryToStory({
  storyId: 'adventure-001',
  characterId: 'alice',
  characterName: 'Alice',
  sceneId: 'scene-005',
  eventType: 'dialogue',
  content: 'Alice said to Bob: "We need to find the treasure before sunset!"',
  relatedCharacters: ['bob'],
  emotionalTone: 'determined',
  importance: 8
});

// タイムラインにも追加
await memoryService.addMemoryToTimeline({
  characterId: 'alice',
  storyId: 'adventure-001',
  storyTitle: 'The Great Adventure',
  eventSequence: 42,
  storySequence: 5,
  eventType: 'key_action',
  phase: 'middle',
  summary: 'Aliceが宝探しを提案し、冒険の目的が明確になった',
  impact: 'ストーリーの方向性を決定づける重要な発言',
  relatedCharacters: ['bob']
});

// 例3: 検索
// ストーリー内でAliceの決意を検索
const storyResults = await memoryService.searchInStory({
  storyId: 'adventure-001',
  query: '決意と覚悟',
  characterId: 'alice',
  emotionalTone: 'determined'
});

// Aliceの成長イベントを時系列で取得
const timeline = await memoryService.searchCharacterTimeline({
  characterId: 'alice',
  query: '成長と変化',
  eventType: 'growth'
});

// AliceとBobの関係の変遷を追跡
const relationship = await memoryService.trackRelationship({
  characterId: 'alice',
  relatedCharacterId: 'bob'
});
```

---

## 5. コスト試算

### 5.1 想定シナリオ

```
システム規模:
- ストーリー数: 100
- キャラクター数: 50
- 平均的なストーリー: 20万ベクトル
- 平均的なキャラクタータイムライン: 500ベクトル
- ベクトルサイズ: 6KB（1024次元 + メタデータ）
- 月間クエリ数: 100万回
- クエリの80%はストーリー内検索、20%はタイムライン検索
```

### 5.2 詳細コスト計算

#### ストレージコスト

```
ストーリーインデックス:
- 100ストーリー × 200,000ベクトル × 6KB = 120 GB
- ストレージコスト: 120 GB × $0.06/GB = $7.20/月

キャラクタータイムライン:
- 50キャラクター × 500ベクトル × 6KB = 0.15 GB
- ストレージコスト: 0.15 GB × $0.06/GB = $0.009/月

合計ストレージコスト: $7.21/月
```

#### PUTコスト（初期アップロード + 月次更新）

```
初期アップロード:
- 全データ: 120.15 GB × $0.20/GB = $24.03（初回のみ）

月次更新（20%のデータを更新と仮定）:
- 月次更新: 120.15 GB × 0.2 × $0.20/GB = $4.81/月
```

#### クエリコスト

```
ストーリー内検索（80万クエリ/月）:
- 平均検索対象: 200,000ベクトル
- データ処理サイズ: 200K × 5KB = 約1GB/クエリ
- Tier 1処理（最初の100Kベクトル）: 100K × 5KB × $0.004/TB = 小額
- Tier 2処理（残り100Kベクトル）: 100K × 5KB × $0.002/TB = 小額
- データ処理コスト: 約 $1.00/100万クエリ × 0.8 = $0.80
- API呼び出し: 800,000 × $2.5/100万 = $2.00
- 小計: $2.80

タイムライン検索（20万クエリ/月）:
- 平均検索対象: 500ベクトル
- データ処理サイズ: 500 × 5KB = 約2.5MB/クエリ
- データ処理コスト: ほぼ無視できる（Tier 1の範囲内）
- API呼び出し: 200,000 × $2.5/100万 = $0.50
- 小計: $0.50

合計クエリコスト: $3.30/月
```

#### 月間総コスト

```
ストレージ: $7.21
PUT（月次更新）: $4.81
クエリ: $3.30
---------------------
月間合計: $15.32

初月のみ: $15.32 + $24.03（初期アップロード） = $39.35
```

### 5.3 従来のベクトルDBとの比較

```
従来のベクトルDB（Pinecone等を想定）:
- ストレージ: 20M vectors × $0.10/1M/月 = $20.00
- コンピュート（p1.x1インスタンス）: $70.00/月
- API呼び出し: 含まれる
---------------------
月間合計: 約 $90.00

コスト削減率: (90 - 15.32) / 90 = 約 83% 削減
```

### 5.4 スケール時のコスト予測

| ストーリー数 | ベクトル数 | ストレージコスト | クエリコスト | 月間合計 |
|------------|-----------|--------------|------------|---------|
| 100 | 20M | $7.21 | $3.30 | **$15.32** |
| 500 | 100M | $36.04 | $16.50 | **$57.35** |
| 1,000 | 200M | $72.08 | $33.00 | **$109.89** |
| 5,000 | 1B | $360.40 | $165.00 | **$530.21** |

**重要**: インデックスを適切に分割することで、クエリコストは線形的にしか増加しない。

---

## 6. 運用ガイドライン

### 6.1 インデックス作成のベストプラクティス

#### ✅ すべきこと

1. **ストーリーごとにインデックスを分ける**
   - 文脈の分離
   - クエリコストの最適化
   - 管理の簡素化

2. **キャラクタータイムラインを作成**
   - 横断検索を高速化
   - 時系列追跡を容易に

3. **非フィルタ可能メタデータを活用**
   - 元テキストや詳細説明は非フィルタ可能に
   - クエリコスト削減

4. **適切な粒度でベクトル化**
   - 1イベント = 1ベクトル
   - あまり細かく分割しすぎない

5. **重要度でフィルタリング**
   - importanceフィールドで重要なイベントを優先検索

#### ❌ 避けるべきこと

1. **全データを1つのインデックスに入れない**
   - クエリコストが高額に
   - 検索精度の低下

2. **次元数を後から変更しようとしない**
   - 変更不可のため、最初に慎重に選択

3. **フィルタ可能メタデータに大きなデータを入れない**
   - 2KB制限
   - クエリコストに影響

4. **過度に細かいインデックス分割**
   - 管理コストの増加
   - 横断検索の複雑化

### 6.2 データライフサイクル管理

#### フェーズ1: アクティブストーリー
```typescript
// 頻繁な更新・検索
location: 'primary-bucket/story-indexes/'
accessPattern: 'high'
```

#### フェーズ2: 完結済みストーリー
```typescript
// 参照のみ、更新なし
location: 'primary-bucket/story-indexes/'
accessPattern: 'medium'
// 月1回のタイムライン更新のみ
```

#### フェーズ3: アーカイブ
```typescript
// 長期保存、稀な検索
location: 'archive-bucket/story-indexes/'
accessPattern: 'low'
// 必要に応じてS3 Glacierに移行検討
```

### 6.3 モニタリング指標

```typescript
interface MemorySystemMetrics {
  // ストレージメトリクス
  totalVectors: number;
  totalStorageGB: number;
  storyIndexCount: number;
  characterIndexCount: number;

  // クエリメトリクス
  queriesPerDay: number;
  averageQueryLatency: number;
  querySuccessRate: number;

  // コストメトリクス
  monthlyStorageCost: number;
  monthlyQueryCost: number;
  costPerQuery: number;

  // パフォーマンス
  cacheHitRate: number;
  averageResultRelevance: number;
}
```

### 6.4 トラブルシューティング

#### 問題1: クエリが遅い
**原因**: インデックスが大きすぎる
**解決策**:
- インデックスを分割
- topKを小さくする
- メタデータフィルタで絞り込み

#### 問題2: 検索精度が低い
**原因**: ベクトルの粒度が適切でない
**解決策**:
- イベント単位でベクトル化
- 埋め込みモデルの見直し
- メタデータの充実

#### 問題3: コストが予想より高い
**原因**: 不必要な全インデックス検索
**解決策**:
- 検索対象インデックスを絞り込み
- キャッシュの活用
- バッチ処理での事前計算

### 6.5 セキュリティとアクセス制御

```typescript
// IAMポリシー例
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3vectors:QueryVectors",
        "s3vectors:GetVectors"
      ],
      "Resource": [
        "arn:aws:s3vectors:*:*:bucket/character-memory-vectors/index/story-*",
        "arn:aws:s3vectors:*:*:bucket/character-memory-vectors/index/character-*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3vectors:PutVectors",
        "s3vectors:DeleteVectors"
      ],
      "Resource": "arn:aws:s3vectors:*:*:bucket/character-memory-vectors/index/*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-west-2"
        }
      }
    }
  ]
}
```

---

## 7. 他社ベクトルDBとの詳細比較

### 7.1 スペック比較表

以下は、主要な商用ベクトルDB（Pinecone等）とAmazon S3 Vectorsの詳細比較です。

| 項目 | 他社 Free | 他社 Usage Based | 他社 Fixed | 他社 Pro | **S3 Vectors** |
|------|----------|-----------------|-----------|---------|---------------|
| **料金** | 無料 | $0.4/100K req | $60/月 | 要相談 | **従量課金** |
| **最大ベクトル数** | 200M | 2B | 2B | 100B | **50M/インデックス** |
| **インデックス数** | - | - | - | - | **10K/バケット** |
| **実質最大ベクトル** | 200M | 2B | 2B | 100B | **500B (50M×10K)** |
| **最大次元数** | 1,536 | 3,072 | 3,072 | 5,000 | **4,096** |
| **ネームスペース** | 100 | 10K | 10K | Unlimited | **10K (index)** |
| **クエリ制限/日** | 10K | Unlimited | 1M | Unlimited | **Unlimited** |
| **メタデータ/ベクトル** | 48KB | 48KB | 48KB | 48KB | **40KB** |
| **データ/ベクトル** | 1MB | 1MB | 1MB | 1MB | **計算上限なし** |
| **データベース全体** | 1GB | 50GB | 50GB | 1TB | **Unlimited** |

### 7.2 料金体系の詳細比較

#### 7.2.1 月額基本料金

| サービス | プラン | 基本料金 | 含まれる内容 |
|---------|-------|---------|------------|
| **他社** | Free | $0 | 200M vectors, 10K queries/日 |
| **他社** | Usage Based | $0 | 基本料金なし、完全従量課金 |
| **他社** | Fixed | $60/月 | 2B vectors, 1M queries/日 |
| **他社** | Pro | 要相談 | カスタム |
| **S3 Vectors** | - | **$0** | **基本料金なし、完全従量課金** |

#### 7.2.2 リクエスト料金

| サービス | プラン | リクエスト単価 | 備考 |
|---------|-------|-------------|------|
| **他社** | Usage Based | **$0.4/100K** = $4/1M | クエリのみ |
| **S3 Vectors** | - | **$2.5/1M クエリ** | クエリAPI |
| **S3 Vectors** | - | **$0.20/GB PUT** | アップロード |

**S3 Vectorsの方が約37.5%安い（クエリ料金）**

#### 7.2.3 実際のコスト比較シナリオ

**シナリオ**: 100ストーリー、20Mベクトル、月100万クエリ

##### 他社 Fixed プラン ($60/月)
```
基本料金: $60/月
- 2B vectors対応（20Mは余裕）
- 1M queries/日（月100万は余裕）
- コンピュートリソース込み

月額合計: $60
```

##### 他社 Usage Based プラン
```
基本料金: $0
ストレージ: 20M vectors × $0.10/1M vectors ≈ $20（推定）
クエリ: 1M queries × $0.4/100K = $40
コンピュート: Pod料金 $70～（推定）

月額合計: 約 $130
```

##### S3 Vectors
```
基本料金: $0
ストレージ: 120GB × $0.06/GB = $7.21
PUT (月次更新20%): 24GB × $0.20/GB = $4.81
クエリAPI: 1M × $2.5/1M = $2.50
クエリ処理: データ処理料金 ≈ $0.80

月額合計: $15.32
```

**コスト比較結果**:
- 他社 Fixed と比較: **74.5%削減** ($60 → $15.32)
- 他社 Usage Based と比較: **88.2%削減** ($130 → $15.32)

### 7.3 スペック詳細比較

#### 7.3.1 ベクトル容量

| 項目 | 他社 Pro | S3 Vectors |
|-----|---------|-----------|
| 単一DB最大 | 100B vectors | 50M/index |
| 分散可能数 | Unlimited namespaces | 10K indexes/bucket |
| **実質最大** | **100B** | **500B (50M×10K)** |

**結論**: S3 Vectorsは適切に設計すれば、他社を上回る容量を実現可能

#### 7.3.2 次元数

| 項目 | 他社 Pro | S3 Vectors |
|-----|---------|-----------|
| 最大次元 | 5,000 | 4,096 |

**評価**: ほぼ互角。一般的な埋め込みモデル（1024～3072次元）には十分

主要な埋め込みモデル:
- OpenAI text-embedding-3-small: 1536次元 ✅ 両方対応
- OpenAI text-embedding-3-large: 3072次元 ✅ 両方対応
- Amazon Titan V2: 1024次元 ✅ 両方対応
- Cohere Embed v3: 1024次元 ✅ 両方対応

#### 7.3.3 メタデータ容量

| 項目 | 他社 | S3 Vectors |
|-----|------|-----------|
| メタデータ/ベクトル | 48KB | 40KB (2KB filterable + 38KB non-filterable) |
| データ/ベクトル | 1MB | 制限なし（実質的） |

**評価**: ほぼ同等。S3 Vectorsは非フィルタ可能メタデータがクエリコストに含まれない利点あり

#### 7.3.4 クエリ性能

| 項目 | 他社 | S3 Vectors |
|-----|------|-----------|
| クエリレイテンシ | <100ms | <1秒（sub-second） |
| 日次クエリ制限 | 10K～Unlimited | **Unlimited** |
| Top-K結果 | 通常100～1000 | **30** |
| 並列クエリ | 対応 | 対応 |

**評価**: 他社がリアルタイム向き、S3 VectorsはRAG/バッチ向き

#### 7.3.5 書き込み性能

| 項目 | 他社 | S3 Vectors |
|-----|------|-----------|
| バッチサイズ | 通常1000 vectors/request | **500 vectors/request** |
| 書き込み速度 | 高速 | **5 requests/秒/index** |
| 複数インデックス並列書き込み | - | **対応（10K indexes）** |

**評価**: 単一インデックスへの書き込みは他社が速い。S3 Vectorsは複数インデックス並列で補完可能

### 7.4 ユースケース別推奨

#### 7.4.1 S3 Vectors が優れているケース ✅

1. **コスト重視のRAGアプリケーション**
   - クエリ頻度: 月数十万～数百万回
   - レイテンシ要件: 1秒以内で許容
   - 予算: できるだけ抑えたい
   - **削減率: 74～88%**

2. **大規模・長期保存が必要**
   - データ量: 数億～数千億ベクトル
   - 保存期間: 長期（年単位）
   - アクセス頻度: 低～中
   - **ストレージコスト: $0.06/GB（業界最安値クラス）**

3. **マルチテナント/マルチストーリー**
   - テナント数: 数百～数千
   - データ分離: 必須
   - 管理: シンプルに
   - **10Kインデックスで柔軟に分離**

4. **バッチ処理・分析ワークロード**
   - クエリ頻度: バッチ実行
   - データ更新: 定期的
   - レイテンシ: 秒単位で許容
   - **クエリコスト: 1/3以下**

5. **AWSエコシステム統合**
   - 既存インフラ: AWS中心
   - 他サービス連携: Bedrock, SageMaker等
   - 運用: AWS内で完結させたい
   - **ネイティブ統合**

#### 7.4.2 他社ベクトルDB が優れているケース ⚠️

1. **リアルタイム検索が必須**
   - レイテンシ要件: <100ms
   - 用途: リアルタイム推薦、チャットボット
   - ユーザー体験: 即時性が重要
   - **S3 Vectors: サブセカンド（最大1秒）**

2. **高頻度の更新が必要**
   - 更新頻度: 秒間数百～数千件
   - リアルタイム性: 即座に反映が必要
   - **S3 Vectors: 5 req/秒/index（制限あり）**

3. **複雑なフィルタリング**
   - Top-K結果: 100件以上必要
   - フィルタ条件: 非常に複雑
   - **S3 Vectors: Top-K=30まで**

4. **非AWSインフラ**
   - クラウド: GCP, Azure, マルチクラウド
   - オンプレミス: 自社データセンター
   - **S3 Vectors: AWSのみ**

5. **プレビュー段階の制約が受け入れられない**
   - 本番環境: ミッションクリティカル
   - SLA要件: 厳格
   - サポート: エンタープライズサポート必須
   - **S3 Vectors: プレビュー中（GA待ち）**

### 7.5 ハイブリッド戦略の提案

#### 最適なアプローチ: ティアード・ストレージ戦略

```
┌─────────────────────────────────────────────────┐
│         リアルタイム層（他社ベクトルDB）           │
│  - 直近1ヶ月のデータ                              │
│  - 頻繁にアクセスされるベクトル                    │
│  - レイテンシ: <100ms                            │
│  - コスト: 高いが必要                              │
└────────────────┬────────────────────────────────┘
                 │
                 │ 自動アーカイブ（月次）
                 ▼
┌─────────────────────────────────────────────────┐
│        コールドストレージ層（S3 Vectors）          │
│  - 1ヶ月以上前のデータ                            │
│  - 履歴検索・分析用                               │
│  - レイテンシ: <1秒                              │
│  - コスト: 最大90%削減                            │
└─────────────────────────────────────────────────┘
```

#### 実装例

```typescript
class HybridVectorStore {
  private hotStore: PineconeClient;    // リアルタイム検索
  private coldStore: S3VectorsClient;  // 長期保存

  async search(query: string, options: {
    includeHistory?: boolean;
    maxLatency?: number;
  }): Promise<SearchResult[]> {

    // リアルタイム層から検索（必須）
    const hotResults = await this.hotStore.query(query, { topK: 10 });

    // 履歴も含める場合、S3 Vectorsも検索
    if (options.includeHistory) {
      const coldResults = await this.coldStore.query(query, { topK: 20 });
      return this.mergeResults(hotResults, coldResults);
    }

    return hotResults;
  }

  // 月次アーカイブジョブ
  async archiveOldData(): Promise<void> {
    const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    // 古いデータをS3 Vectorsに移行
    const oldVectors = await this.hotStore.fetchOldVectors(oneMonthAgo);
    await this.coldStore.bulkInsert(oldVectors);

    // 移行完了後、リアルタイム層から削除
    await this.hotStore.deleteOldVectors(oneMonthAgo);

    logger.info(`アーカイブ完了: ${oldVectors.length}件`);
  }
}
```

**このハイブリッド戦略のメリット**:
- リアルタイム性能を維持しつつ、コストを60～80%削減
- データの長期保存が可能
- 必要に応じて履歴検索も実現

### 7.6 意思決定フローチャート

```
あなたのプロジェクトに最適なのは？

START
  │
  ▼
[レイテンシ要件は100ms以内？]
  │
  YES → [他社ベクトルDB] 推奨
  │      (Pinecone, Weaviate等)
  │
  NO
  ▼
[予算は月$100以上確保できる？]
  │
  NO → [S3 Vectors] 推奨
  │      (コスト最優先)
  │
  YES
  ▼
[データ量は10億ベクトル以上？]
  │
  YES → [S3 Vectors] 推奨
  │      (大規模データ向き)
  │
  NO
  ▼
[更新頻度は秒間10件以上？]
  │
  YES → [他社ベクトルDB] 推奨
  │      (高速書き込み必要)
  │
  NO
  ▼
[AWSインフラが中心？]
  │
  YES → [S3 Vectors] 推奨
  │      (AWS統合メリット)
  │
  NO → [他社ベクトルDB] 検討
  │      (マルチクラウド)
  │
  ▼
[リアルタイム + 履歴検索が必要？]
  │
  YES → [ハイブリッド戦略] 推奨
  │      (両方の長所を活用)
  │
  NO
  ▼
[S3 Vectors] または [他社ベクトルDB]
いずれかを選択
```

### 7.7 キャラクター記憶システムへの推奨

本プロジェクトの「キャラクター記憶システム」に対する推奨：

#### ✅ S3 Vectors を推奨する理由

1. **ユースケースが完全に合致**
   - クエリ頻度: 中程度（月数十万～数百万）
   - レイテンシ: 1秒以内で十分（RAG用途）
   - データ量: 大規模（数億ベクトル想定）
   - 保存期間: 長期

2. **コスト効率が圧倒的**
   - 他社 Fixed ($60) vs S3 Vectors ($15.32) = **74.5%削減**
   - スケール時もコスト増加が緩やか

3. **ストーリー別インデックス設計と相性抜群**
   - 10Kインデックスで柔軟な分離
   - マルチテナント・マルチストーリーに最適

4. **長期保存コストが最安**
   - ストレージ: $0.06/GB（業界最安値クラス）
   - 数年間の記憶保持が現実的

5. **AWS統合メリット**
   - Bedrock（Claude）との連携
   - Lambdaでのバッチ処理
   - DynamoDBとの組み合わせ

#### ⚠️ 注意点と対策

| 制約 | 影響 | 対策 |
|-----|-----|-----|
| Top-K=30 | 一度に30結果まで | 複数回クエリまたはメタデータフィルタで絞り込み |
| 書き込み5req/秒 | バルク追加が遅い | 複数インデックス並列書き込み |
| プレビュー段階 | GA待ち | 非クリティカルな機能で先行導入 |
| リージョン限定 | ap-northeast-1未対応 | us-west-2で開始、GA後に移行 |

### 7.8 結論: 実際どうなの？

#### 総合評価

| 評価項目 | 他社ベクトルDB | S3 Vectors | 勝者 |
|---------|--------------|-----------|-----|
| **コスト** | 中～高 | **低** | 🏆 **S3 Vectors** |
| **リアルタイム性能** | **優秀** | 劣る | 🏆 **他社** |
| **スケーラビリティ** | 優秀 | **優秀** | 🤝 引き分け |
| **容量** | 100B | **500B（実質）** | 🏆 **S3 Vectors** |
| **使いやすさ** | **優秀** | 良好 | 🏆 **他社** |
| **AWS統合** | 普通 | **優秀** | 🏆 **S3 Vectors** |
| **本番実績** | **豊富** | プレビュー中 | 🏆 **他社** |

#### 最終推奨

```
【キャラクター記憶システムに最適】
→ Amazon S3 Vectors 🎯

理由:
✅ コスト: 74～88%削減
✅ ユースケース: RAG/バッチ処理に最適
✅ 設計: ストーリー別インデックスと相性◎
✅ スケール: 数千億ベクトルまで対応
✅ 長期保存: 業界最安値クラス

注意:
⚠️ プレビュー段階（GA待ち）
⚠️ リアルタイム性能は他社に劣る
⚠️ 東京リージョン未対応（us-west-2推奨）

【いますぐ本番環境で使いたい場合】
→ Pinecone等の他社ベクトルDB
→ またはハイブリッド戦略（両方使用）
```

**実際の判断**: S3 Vectorsは**コストとスケーラビリティで圧倒的**だが、プレビュー段階なので、非クリティカルな機能での先行導入を推奨。GA後に全面移行を検討。

---

## まとめ

### キャラクター記憶システムの利点

1. **コスト効率**: 従来のベクトルDBと比較して最大83%のコスト削減
2. **柔軟な検索**: ストーリー内検索と横断検索の両立
3. **スケーラビリティ**: 数千ストーリー、数億ベクトルまで対応可能
4. **管理容易性**: インデックス単位での管理・削除
5. **文脈保持**: ストーリーごとに独立した記憶空間

### 次のステップ

1. プロトタイプ環境でのPOC実施
2. 小規模ストーリー（10件程度）での検証
3. パフォーマンス測定とチューニング
4. 本番環境への展開

### 参考リソース

- [Amazon S3 Vectors公式ドキュメント](https://docs.aws.amazon.com/AmazonS3/latest/userguide/s3-vectors.html)
- [Amazon Bedrock Embeddings](https://docs.aws.amazon.com/bedrock/latest/userguide/embeddings.html)
- [S3 Vectors価格ページ](https://aws.amazon.com/s3/pricing/)

---
