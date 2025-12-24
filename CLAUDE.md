# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

MastraフレームワークとS3Vectorsを使用したキャラクターAIエージェントの思い出RAGシステム。エピソードから事実を抽出し、各キャラクターが「知っているべき情報」のみをRAGで取得できる。

## 開発コマンド

```bash
# 開発サーバー起動（Mastra Studio: http://localhost:4111）
npm run dev

# ビルド
npm run build

# プロダクション起動
npm start

# エピソードをS3Vectorsにインジェスト
npx tsx scripts/ingest-episodes.ts

# 特定のエピソードのみ
npx tsx scripts/ingest-episodes.ts --episode 1
```

## アーキテクチャ

### システム構成

```
Episode.md → LLM差分抽出 → S3Vectors → キャラクターエージェント
                                           ↑
                              RuntimeContext(characterId, episodeNo)
                                           ↓
                              フィルタ自動適用 → RAG検索
```

### コア構成要素

1. **Mastraインスタンス** (`src/mastra/index.ts`)
   - weatherAgent, characterAgentを統合
   - S3Vectorsをベクトルストアとして登録
   - LibSQLStore（インメモリ）でストレージ管理

2. **キャラクターメモリRAG** (`src/mastra/character-memory/`)
   - `extract-memory.ts`: LLMでエピソードから事実を抽出（公開/秘密を分類）
   - `memory-query-tool.ts`: RuntimeContextからフィルタを自動生成してRAG検索
   - `character-agent.ts`: RuntimeContextで動的にキャラクターを切り替え

3. **記憶の分類ルール**
   - `scope: "world"` → 公開情報（全キャラクターが見える）
   - `scope: "character"` → 秘密情報（本人のみ見える）

### 環境変数

```bash
S3_VECTORS_BUCKET_NAME="your-vector-bucket"
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
```

## 技術スタック

- **Node.js**: >=20.9.0
- **Mastraフレームワーク**: エージェント、ツール、ワークフロー
- **S3Vectors**: AWS S3ベースのベクトルストア
- **Amazon Bedrock**: Claude 3.5 Sonnet/Haiku、Titan Embed V2
- **TypeScript**: ES2022、bundlerモジュール解決

## 重要な設計ポイント

- **未来を知らないルール**: `episodeNo <= currentEpisodeNo - 1`のフィルタで未来の情報を除外
- **他キャラの秘密を知らないルール**: `scope: "character"`の情報は`characterId`が一致する場合のみ取得
- **フィルタ自動適用**: RuntimeContextに`characterId`と`currentEpisodeNo`を設定するだけでフィルタが自動生成される

## 関連ドキュメント

- `docs/CHARACTER_MEMORY_RAG.md` - キャラクターメモリRAGの詳細仕様
- `docs/EPISODE_SYNC_DESIGN.md` - DB連携・自動同期の設計
