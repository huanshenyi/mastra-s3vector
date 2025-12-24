# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

このリポジトリは、Mastraフレームワークを使用した天気情報アプリケーションです。エージェント、ツール、ワークフロー、スコアラーを組み合わせて、天気情報の取得とアクティビティの提案を行います。

## 開発コマンド

```bash
# 開発サーバーの起動
npm run dev

# ビルド
npm run build

# プロダクション起動
npm start
```

## アーキテクチャ

### コア構成要素

プロジェクトは以下の主要コンポーネントで構成されています：

1. **Mastraインスタンス** (`src/mastra/index.ts`)
   - ワークフロー、エージェント、スコアラーを統合
   - LibSQLStore（メモリ内またはファイルベース）でストレージ管理
   - PinoLoggerでログ出力
   - 観測可能性機能が有効（`observability.default.enabled: true`）
   - テレメトリは非推奨のため無効化

2. **エージェント** (`src/mastra/agents/weather-agent.ts`)
   - `weatherAgent`: OpenAI GPT-4o-miniを使用した天気アシスタント
   - `weatherTool`を使用して天気データを取得
   - 3つのスコアラー（toolCallAppropriateness、completeness、translation）で評価
   - LibSQLStoreベースのメモリ機能を持つ（`file:../mastra.db`に保存）

3. **ツール** (`src/mastra/tools/weather-tool.ts`)
   - `weatherTool`: Open-Meteo APIを使用して現在の天気情報を取得
   - ジオコーディングAPIで都市名を緯度経度に変換
   - 天気コードを人間が読める条件文字列に変換

4. **ワークフロー** (`src/mastra/workflows/weather-workflow.ts`)
   - `weatherWorkflow`: 2ステップのワークフロー
     1. `fetchWeather`: 天気予報を取得
     2. `planActivities`: エージェントを使用してアクティビティを提案
   - ストリーミングレスポンスで進行状況を表示

5. **スコアラー** (`src/mastra/scorers/weather-scorer.ts`)
   - `toolCallAppropriatenessScorer`: ツール呼び出しの正確性を評価
   - `completenessScorer`: レスポンスの完全性を評価
   - `translationScorer`: 非英語の地名が適切に翻訳されているかをLLMで評価

### データフロー

1. ユーザー入力 → weatherAgent → weatherTool → Open-Meteo API → レスポンス
2. ユーザー入力 → weatherWorkflow → fetchWeather → planActivities (エージェント使用) → アクティビティ提案

### ストレージ戦略

- **Mastraメインストレージ**: `:memory:`（インメモリ）- 観測データとスコアを保存
  - 永続化が必要な場合は`file:../mastra.db`に変更可能
- **エージェントメモリ**: `file:../mastra.db`（ファイルベース）- 会話履歴を保存
  - パスは`.mastra/output`ディレクトリからの相対パス

## 技術スタック

- **Node.js**: >=20.9.0
- **Mastraフレームワーク**: エージェント、ツール、ワークフロー、評価機能を提供
- **TypeScript**: ES2022、bundlerモジュール解決
- **外部API**: Open-Meteo（天気データとジオコーディング）
- **LLM**: OpenAI GPT-4o-mini（エージェントとスコアラー用）

## 開発上の注意点

- `tsconfig.json`の`moduleResolution: "bundler"`設定により、最新のモジュール解決が使用される
- Mastraフレームワークのバージョン: CLI 0.17.7、Core 0.23.3
- エージェントのスコアリングはすべてサンプリングレート100%（`rate: 1`）
- テレメトリは11月4日のリリースで削除予定（現在無効化済み）
