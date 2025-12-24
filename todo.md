# Mastraで実装する「エピソード差分メモリRAG」手順書（キミガタリ向け）

目的：
- キャラクターAIエージェントの“記憶”をRAGで実現する
- ただし「各エピソード時点までしか覚えない（未来を参照しない）」を厳密に守る
- エピソードの削除/更新に追随して、記憶（ベクトル）も同期する

---

## 0. 設計の結論（まずこれを採用する理由）
**“継続メモリ”ではなく「エピソード由来の差分（delta）メモリ」をRAG化する。**

理由：
- RAGは「文書→チャンク→埋め込み→ベクトルDB→検索でコンテキスト注入」が基本で、Mastraはこの流れを標準APIで提供している :contentReference[oaicite:0]{index=0}
- “未来を知らない”を守るには、検索時に「episodeNoの上限（cutoff）」で必ずゲートするのが最も堅い（後述のmetadata filterで実現） :contentReference[oaicite:1]{index=1}
- 削除/更新に強い：差分（delta）がソース・オブ・トゥルースになり、ベクトルは常に再生成可能になる

---

## 1. まず作るもの（DBとメタデータ設計）

### 1-1. RDB（正）に「差分メモリ」テーブルを追加
実装：
- `episodes`: `episodeId`, `episodeNo`, `text`, `version`, `deletedAt`
- `memory_deltas`: `deltaId`, `episodeId`, `episodeNo`, `version`, `scope`, `characterId`, `facts[]`, `hash`, `deletedAt`
- `memory_vectors`: `vectorId`, `deltaId`, `episodeId`, `episodeNo`, `version`, `scope`, `characterId`, `factIndex`

理由：
- 更新/削除のたびに「どのベクトルを消す/差し替えるか」を確実に追跡する必要がある（vectorIdをDBで管理するのが一番安全）
- 1 fact = 1 chunk にすると、更新差分が小さくなり再埋め込み・削除対象の特定が簡単になる

---

## 2. Ingest（エピソード→差分メモリ→ベクトル）をWorkflow化

### 2-1. Workflow: `ingestEpisode(episodeId)`
実装手順：
1) エピソード本文をRDBから取得（episodeNo/version含む）
2) LLMで「覚えるべき差分（facts）」を抽出して `memory_deltas` に保存  
   - 出力スキーマ（例）：
     - `worldFacts: string[]`
     - `characterFacts: Record<characterId, string[]>`
3) `facts` をチャンク化（基本：1 fact = 1 chunk）
4) Mastraの `MDocument` / chunking APIで整形（必要なら） :contentReference[oaicite:2]{index=2}
5) `embedMany` で埋め込み生成 :contentReference[oaicite:3]{index=3}
6) Vector Storeへ upsert（例：PgVector） :contentReference[oaicite:4]{index=4}
7) `memory_vectors` に vectorId を保存

理由：
- MastraのRAGは「チャンク→埋め込み→ベクトルDB格納」の標準手順が用意されている :contentReference[oaicite:5]{index=5}
- 後で削除・更新するため、**vectorIdを決め打ち**（後述）し、RDBに保存しておくのが運用上必須

---

## 3. “未来を知らない”を強制する Retrieval 設計（最重要）

### 3-1. Retrieval時に渡す入力（必須）
- `currentEpisodeNo`（今このキャラがいる話数）
- `activeCharacterId`（今の発話主体キャラID）
- `query`（ユーザ入力 / シーン要約）

理由：
- 「どこまで覚えてよいか」は会話のたびに変わるため、クエリ実行時にcutoffを決める必要がある

### 3-2. 検索フィルタ（ゲート）を必ず入れる
実装（概念）：
- `cutoff = currentEpisodeNo - 1`
- filter条件：
  - `episodeNo <= cutoff`
  - `scope == "world" OR (scope == "character" AND characterId == activeCharacterId)`
  - `deletedAt == null`
  - `version == latest`（または vectorIdが最新だけ残る運用にする）

理由：
- Mastraは**MongoDB/Sift互換の統一メタデータフィルタ**をベクトル検索に併用できる :contentReference[oaicite:6]{index=6}
- これで「未来エピソードの記憶が混入する事故」を構造的に防げる

### 3-3. 実装は `createVectorQueryTool()` をベースにする
実装：
- エージェント/ワークフローから呼べる“検索ツール”として `createVectorQueryTool()` を作る（filter込みで） :contentReference[oaicite:7]{index=7}

理由：
- RAG検索をツール化すると「いつ・どの条件で検索したか」が明示的になり、デバッグ/トレースもしやすい

---

## 4. “エピソードごとにindexを作りたい”の扱い（2案）

### 案A（おすすめ）：物理indexは1つ、episodeNoで論理分割
実装：
- indexNameは1つ（例 `kmgt_memory`）
- metadataに `episodeId/episodeNo/characterId/scope` を必ず入れる
- 取得は filter で切る（上記）

理由：
- 検索が1回で済み、エピソードが増えても運用が楽
- Mastraはmetadata filter併用を前提としている :contentReference[oaicite:8]{index=8}

### 案B：物理indexをエピソード単位に分ける
実装：
- indexNameを `kmgt_ep_0001`, `kmgt_ep_0002`… のように作る
- Retrieval時は `1..cutoff` の複数indexに対して検索 → 結果をマージ（rerank推奨） :contentReference[oaicite:9]{index=9}

理由：
- “エピソード単位の消し込み”は簡単だが、検索が複数回になりがちでスケールしづらい
- どうしても分けたい強い理由がある場合のみ採用

---

## 5. 更新・削除に追随する（記憶同期の実装）

### 5-1. エピソード更新：`updateEpisode(episodeId)`
実装手順：
1) episodes.version++（新本文を保存）
2) 既存 `memory_deltas` を deleted扱い（または versionで無効化）
3) `ingestEpisode(episodeId)` を再実行（新delta生成→新vector upsert）
4) 古いvectorを削除（後述のvectorId一覧で削除）

理由：
- “更新＝過去の事実が変わる”ので、古い事実のベクトルを残すと誤回収する
- MastraのPgVectorは `deleteVector({ indexName, id })` のように **ID指定削除**が基本として提供されている :contentReference[oaicite:10]{index=10}

### 5-2. エピソード削除：`deleteEpisode(episodeId)`
実装手順：
1) episodes.deletedAt を立てる
2) memory_deltas.deletedAt を立てる
3) memory_vectors から該当vectorIdを取得し、全て deleteVector する :contentReference[oaicite:11]{index=11}

理由：
- “削除された話の記憶”が残ると、回収され続けるリスクがある
- ベクトルストアは「メタデータfilterで一括削除」がストア実装によって差があるため、**確実な運用はID削除**（vectorIdをDBで握る）が堅い  
  ※実際に「filter削除が欲しい」という要望も出ている :contentReference[oaicite:12]{index=12}

---

## 6. vectorId設計（更新/削除を壊さないコツ）

実装：
- vectorIdを決め打ちする（例）
  - `vec:${episodeId}:v${version}:${scope}:${characterId ?? "world"}:${factIndex}`
- 生成時に必ず `memory_vectors` に保存する

理由：
- PgVectorの削除がID単位である以上、**IDが再現可能**であるほど運用が簡単 :contentReference[oaicite:13]{index=13}
- “更新で旧ベクトルを確実に消す”ためには、旧versionのID一覧を特定できる必要がある

---

## 7. 仕上げ（品質と運用）

### 7-1. RAGの精度調整（任意だが推奨）
実装：
- 取得結果を rerank する（MastraのRAGはretrieval/rerankingの導線がある） :contentReference[oaicite:14]{index=14}
- チャンクの情報密度を上げる（重複除去・短文化）  
  Mastraにも“情報密度最適化”の例がある :contentReference[oaicite:15]{index=15}

理由：
- “長いままのchunk”はノイズが増え、未来回避ゲートがあっても回答がぶれる

### 7-2. テスト（必須）
実装：
- `currentEpisodeNo` を変えた時に、回収されるfactsが単調増加になること
- 未来（episodeNo > cutoff）のfactsが1件も返らないこと
- 更新後に古いfactsが返らないこと
- 削除後に該当episodeIdのfactsが返らないこと

理由：
- 今回の要件は「正しさ（未来を知らない）」が最重要で、回帰しやすい

---

## 8. 最小の実装順（おすすめの着手順）
1) RDBテーブル追加（memory_deltas / memory_vectors）
2) `ingestEpisode` を作る（delta抽出→embedMany→upsert→vectorId保存） :contentReference[oaicite:16]{index=16}
3) `createVectorQueryTool` で “cutoff + scope” フィルタ検索を実装 :contentReference[oaicite:17]{index=17}
4) `updateEpisode` / `deleteEpisode` の同期（vectorIdでdelete） :contentReference[oaicite:18]{index=18}
5) テスト→運用（ログ/トレース）へ

---