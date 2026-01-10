---
name: NextjsPostgresIngest
overview: 現状Viteフロントで行っているJSON解析/集計を、Next.jsフルスタック+Postgresに移し、追記取り込みと日別/月別/席別/時間帯別の集計を安定提供する。実時間は「開始10:00・終了15:06」へ線形フィットして算出し、後から再計算できる補正情報も保持する。
todos:
  - id: scaffold-nextjs
    content: Next.js(App Router)を新規セットアップし、既存UIコンポーネント移植の受け皿を作る
    status: completed
  - id: db-schema
    content: Postgres + ORM(Prisma/Drizzleのどちらか)で imports/raw_frames/detections のスキーマとマイグレーションを作る
    status: completed
    dependencies:
      - scaffold-nextjs
  - id: ingest-api
    content: "`POST /api/imports` を実装し、JSONを受け取り、最大frame_numberを算出して線形フィット用パラメータをimportsに保存する"
    status: completed
    dependencies:
      - db-schema
  - id: normalize-detections
    content: JSONをフレーム単位でパースして detections にinsert（seat_id決定、event_time算出）
    status: completed
    dependencies:
      - ingest-api
  - id: metrics-api
    content: 日別/月別/時間帯別/席別の集計APIを追加（まずはSQL group byで実装）
    status: in_progress
    dependencies:
      - normalize-detections
  - id: wire-ui-to-api
    content: DashboardをAPI呼び出しに置き換え、フロントでの全件集計（WebWorker）を廃止/最小化する
    status: pending
    dependencies:
      - metrics-api
---

# Next.js+Postgresでの取り込み/集計基盤プラン

## 目的

- いまフロント（Vite + WebWorker）でやっている **全件パース/集計** をサーバ側に移し、データが追記で増えても破綻しない構成にする。
- JSONの `timestamp` は“スクリプト実行時刻”由来で信用しない前提とし、**開始=2025-06-30 10:00、終了=15:06** に合わせて **frame_number を実時間へ線形フィット**して `event_time` を生成する。

## 現状の重要な観察（移行対象）

- フロントは `App.tsx` でJSON文字列を受け取り、`data.worker.ts` が `ProcessedFrame` を生成し、
- 時系列集計（1min/15min/hour）
- 席の滞在ブロック（`generateSeatUsageTimeline`）
- 補間した席占有のタイムライン

を全フレーム走査で作っています（規模が増えると限界）。

- 参照: `data.worker.ts`（集計/ブロック生成）

## アーキテクチャ（MVP）

```mermaid
flowchart LR
  ImportCLI[Import_CLI] -->|streamParseAndNormalize| Postgres[(Postgres)]
  Browser[Browser] -->|queryMetrics| NextAPI[Nextjs_API_Route]
  NextAPI -->|readAggregates| Postgres
```



- **Next.js 15**: UI + API Routes（検索/集計/取り込み状態の参照）
- **Postgres**: Raw保管 + 正規化テーブル + 集計クエリ
- **取り込み（数百MB対応）**: ブラウザアップロードは行わず、ローカルの **CLIでファイルパス指定**して取り込む（ストリーミングパース + バッチINSERT）。将来必要ならジョブ化（queued/running/done/failed）へ拡張。

## データモデル（最小）

### 1. imports（取り込み単位）

- `id`
- `source_name`（ファイル名など）
- `status`（queued/running/done/failed）
- `start_time_real`（固定: 2025-06-30 10:00 を指定可能に）
- `end_time_real`（固定: 15:06 を指定可能に）
- `time_mapping`（線形フィット情報: durationSeconds, maxFrameNumber, method="linear"）
- `created_at`

### 2. raw_frames（Raw保持: 再処理/監査用）

- `import_id`
- `frame_key`（例: frame_001）
- `frame_number`
- `raw_payload`（jsonb; そのフレームの検出配列）

### 3. detections（正規化: クエリ/集計用）

- `import_id`
- `frame_number`
- `event_time`（実時間: 線形フィット結果）
- `person_id`
- `seat_id`（`confirmed_seat_id || raw_seat_id`）
- `confidence`
- `bbox`（必要なら）

### インデックス方針

- `detections(import_id, event_time)`（期間フィルタ）
- `detections(import_id, seat_id, event_time)`（席別）
- `detections(import_id, person_id, event_time)`（人物別/グループ導出）

## 実時間の線形フィット仕様

- 入力:
- `start_time_real = 2025-06-30 10:00:00`
- `end_time_real = 2025-06-30 15:06:00`
- `max_frame_number`（JSON内の最大frame_number）
- 変換:
- `t = (frame_number - min_frame)/(max_frame-min_frame)`
- `event_time = start_time_real + t * (end_time_real - start_time_real)`
- 注意:
- 後から `end_time_real` が変わっても再計算できるよう、**補正パラメータをimportsに保存**

## API設計（画面で必要なものから）

- **取り込み**
- **MVPはHTTPアップロードしない**（数百MBを安全に扱うため）。代わりにCLIで取り込みを実行する。
- 例: `npm run import -- --file /absolute/path/to.json --start "2025-06-30T10:00:00" --end "2025-06-30T15:06:00"`
- CLIが `imports` を作成し、`raw_frames`/`detections` を書き込み、集計APIが参照する。
- `GET /api/imports/:id`（進捗/エラー）
- （任意）CLI取り込み中/完了をUIで見えるようにする
- **イベント/一覧**
- `GET /api/detections?importId=&from=&to=&seatId=&q=&cursor=`
- **集計**
- `GET /api/metrics/occupancy?importId=&from=&to=&bucket=hour|15min|day|month`
- `GET /api/metrics/seatUsage?importId=&from=&to=`（席別滞在ブロック相当）

## 取り込み方式（数百MBの現実解）

- **JSON全体を `JSON.parse` しない**（メモリ爆発しやすい）。ストリーミングで読む。
- **バッチINSERT**（例: 数千〜数万行単位）で `detections` に書き込む。
- **線形フィットに必要な max_frame_number** を得るため、MVPは次のいずれか:
- **2パス**: 1回目でmaxだけ算出 → 2回目で本取り込み（単純で確実）
- **1パス+後更新**: 先に `frame_number` を入れて、max確定後に `event_time` を更新（更新コスト増）

## UI移行方針

- 現在の `components/Dashboard.tsx` は「受け取った集計済みデータを描画」する責務に寄せる。
- `components/FileUpload.tsx` の「startTime入力」は、Next.js側では **import設定（start/end）** として扱う。
- ViteアプリからNext.jsへ段階移行:
- まずNext.jsを新設し、既存コンポーネントを移植
- WebWorker集計は廃止し、APIから集計済みレスポンスを取得

## レポジトリ構成案（このworkspaceを基に）

- `apps/web`（Next.js）
- `packages/shared`（型定義/集計DTOなど共通）
- もしくは単一Next.jsに寄せて簡素化（MVP優先）

## 実装で触る主要ファイル（現状からの移行元）

- [`/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/data.worker.ts`](/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/data.worker.ts)（集計ロジックの移植元）
- [`/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/types.ts`](/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/types.ts)（型の移植元）
- [`/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/components/Dashboard.tsx`](/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/components/Dashboard.tsx)（描画コンポーネントの移植元）
- [`/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/components/FileUpload.tsx`](/Users/yuukun/.cursor/worktrees/dashboard-feature/cxr/components/FileUpload.tsx)（アップロードUXの移植元）

## 実装タスク（MVP）

- Next.jsプロジェクト新設（App Router）
- Postgres（docker-compose）とマイグレーション導入（Prisma or Drizzleを採用）
- `imports`/`raw_frames`/`detections` のスキーマ作成
- JSON取り込み（CLI: ストリーミングパース→DB保存）
- 線形フィットで `event_time` を計算し `detections` へ正規化
- 集計API（時間バケット、席別、日別/月別/時間帯別）
- 既存DashboardのデータソースをAPIに差し替え