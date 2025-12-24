/**
 * キャラクターメモリRAGの型定義
 *
 * エピソードごとの差分メモリをベクトル化し、
 * キャラクターが「未来を知らない」状態でRAG検索できるようにする
 */

/** メモリのスコープ：ワールド共通 or キャラクター固有 */
export type MemoryScope = 'world' | 'character';

/** キャラクターID */
export type CharacterId =
  | 'himuro-nigo'      // 氷室二郷（主人公）
  | 'genshin-tsubasa'  // 幻神翼（カフェ店長/政府監視者）
  | 'kamishiro-rei'    // 神代零（謎の女性）
  | 'misaki';          // 美咲（二郷の妹）

/** キャラクター情報 */
export interface CharacterInfo {
  id: CharacterId;
  name: string;
  description: string;
}

/** 登録済みキャラクター一覧 */
export const CHARACTERS: Record<CharacterId, CharacterInfo> = {
  'himuro-nigo': {
    id: 'himuro-nigo',
    name: '氷室二郷',
    description: '17歳の高校生。時間停止能力を持つ世界最強の異能力者。普通の人生を望んでいる。'
  },
  'genshin-tsubasa': {
    id: 'genshin-tsubasa',
    name: '幻神翼',
    description: 'カフェ「ブルームーン」店長。政府超能力対策本部の監視者。二郷を監視している。'
  },
  'kamishiro-rei': {
    id: 'kamishiro-rei',
    name: '神代零',
    description: '琥珀色の瞳を持つ謎の女性。二郷を組織に引き入れようとしている。'
  },
  'misaki': {
    id: 'misaki',
    name: '美咲',
    description: '二郷の妹。'
  }
};

/** エピソードから抽出された差分メモリ（1件の事実） */
export interface MemoryFact {
  /** この事実のテキスト */
  text: string;
  /** スコープ：world=全キャラ共通、character=特定キャラ固有 */
  scope: MemoryScope;
  /** character スコープの場合、対象キャラクターID */
  characterId?: CharacterId;
  /** 重要度（1-5、5が最重要） */
  importance: number;
}

/** エピソード単位の差分メモリ */
export interface EpisodeDelta {
  /** エピソードID（ファイル名など） */
  episodeId: string;
  /** エピソード番号（1, 2, 3...） */
  episodeNo: number;
  /** バージョン（更新時にインクリメント） */
  version: number;
  /** 抽出された事実リスト */
  facts: MemoryFact[];
  /** 抽出日時 */
  extractedAt: Date;
}

/** ベクトルストアに保存するメタデータ */
export interface MemoryVectorMetadata {
  /** ベクトルID（決め打ち形式: vec:{episodeId}:v{version}:{scope}:{characterId}:{factIndex}） */
  vectorId: string;
  /** エピソードID */
  episodeId: string;
  /** エピソード番号 */
  episodeNo: number;
  /** バージョン */
  version: number;
  /** スコープ */
  scope: MemoryScope;
  /** キャラクターID（scopeがcharacterの場合） */
  characterId: string;
  /** 事実のインデックス */
  factIndex: number;
  /** 元のテキスト（検索結果で返す） */
  text: string;
  /** 重要度 */
  importance: number;
}

/** RAG検索時のクエリパラメータ */
export interface MemoryQueryParams {
  /** 検索クエリ（シーン説明やユーザー入力） */
  query: string;
  /** 現在のエピソード番号（この番号-1までの記憶を検索） */
  currentEpisodeNo: number;
  /** 発話中のキャラクターID */
  activeCharacterId: CharacterId;
  /** 取得件数 */
  topK?: number;
}

/** RAG検索結果 */
export interface MemorySearchResult {
  /** 事実テキスト */
  text: string;
  /** 類似度スコア */
  score: number;
  /** メタデータ */
  metadata: MemoryVectorMetadata;
}

/** LLMによる差分抽出の出力スキーマ */
export interface ExtractedMemory {
  /** ワールド共通の事実 */
  worldFacts: Array<{
    text: string;
    importance: number;
  }>;
  /** キャラクター固有の事実 */
  characterFacts: Record<CharacterId, Array<{
    text: string;
    importance: number;
  }>>;
}
