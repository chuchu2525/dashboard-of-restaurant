# 実装計画書：動画尺入力（HH:MM:SS）・線形時間補正・横スクロール対応

## 0. 目的（要件）
- **動画尺を HH:MM:SS で入力可能にする**
- **開始時刻＋動画尺に全フレームを線形配分**して、実時間 `5:06:00` に収める
- **全グラフで補正後の時刻を使用**する
- **横スクロール対応**（時系列は必須、その他も対応）

## 1. 事前確認（済）
- アップロード初期化は `backend/app/api/videos/upload/init/route.ts` で受け付けている
- `recordingEndTime` は任意だが **現状フロントで固定値が送られている**（`App.tsx`）
- フレームの `realTimestamp` は `backend/app/api/videos/upload/chunk/route.ts` 内で算出している
- `backend/lib/timeConverter.ts` は **FPSベース**の時刻計算のみ（線形補正未実装）
- `backend/prisma/schema.prisma` の `Video` / `Frame` は **既に必要な項目（start/end/totalFrames）を保持**

## 2. 追加確認（不足しがちな点の明示）
- **totalFrames が 1 以下**のとき、`totalFrames - 1` が 0 になる（線形補正のゼロ除算対策が必要）
- **frameNumber が欠落**している場合、均等配分の連続性は崩れる（要件上は許容）
- **入力時刻はローカルタイム**として扱う（既存の `parseTimestamp` はローカルDate生成）
- **既存データの再補正はしない**（新規アップロードのみ対象）

## 3. 実装範囲（影響範囲）
- フロント：`components/FileUpload.tsx`, `App.tsx`
- バックエンド：`backend/app/api/videos/upload/init/route.ts`, `backend/app/api/videos/upload/chunk/route.ts`, `backend/lib/timeConverter.ts`
- 表示：`components/Dashboard.tsx`
- DBスキーマ変更：**不要**（既存の `recordingStartTime/recordingEndTime/totalFrames` で対応）

## 4. 実装設計（具体的な変更内容）

### 4-1. 動画尺入力（HH:MM:SS）
**対象**: `components/FileUpload.tsx`

- 追加する state
  - `durationHms: string`（例：`"05:06:00"`）
- 追加UI
  - ラベル: `Video Duration (HH:MM:SS)`
  - 1行テキスト入力
- バリデーション（送信時）
  - 正規表現：`/^\d{1,2}:\d{2}:\d{2}$/`
  - 分/秒は `00-59` の範囲
  - `00:00:00` は **エラー扱い**
- 送信
  - `onFileUploadSuccess(fileContent, fileName, startTime, durationHms)` へ拡張

**理由**: 線形補正には動画尺が必須のため

---

### 4-2. App → init API へ動画尺を渡す
**対象**: `App.tsx`

- `handleFileUpload` / `processDataWithAPI` に `durationHms` を追加
- `init` API の body に `recordingDuration: durationHms` を追加
- 既存の `recordingEndTime` 固定値送信は撤廃

**理由**: start+duration からサーバで endTime を決めるため

---

### 4-3. init API で録画終了時刻を生成
**対象**: `backend/app/api/videos/upload/init/route.ts`

- `initSchema` に `recordingDuration` を追加
  - 形式：`HH:MM:SS`
- `recordingStartTime` と `recordingDuration` から `recordingEndTime` を算出
- `video` 作成時に `recordingEndTime` をセット

**理由**: DBに正しい終了時刻を保存し、後続の補正計算に使うため

---

### 4-4. 線形補正関数の追加
**対象**: `backend/lib/timeConverter.ts`

追加関数（設計）:
- `calculateLinearTimestamp(recordingStartTime, durationSeconds, frameIndex, totalFrames)`

計算式:
- `ratio = totalFrames <= 1 ? 0 : frameIndex / (totalFrames - 1)`
- `timestamp = start + ratio * durationSeconds`

**理由**: 要件通り、全フレームを動画尺に均等配分するため

---

### 4-5. chunk 処理で補正時刻を使用
**対象**: `backend/app/api/videos/upload/chunk/route.ts`

- 既存の `calculateRealTimestamp(...)` を **`calculateLinearTimestamp(...)` に置換**
- `durationSeconds = (recordingEndTime - recordingStartTime) / 1000`
- `frameIndex` は `frameNumber` を基準に 0 or 1 起点で統一
  - 例: `frameNumber` が 1 起点なら `frameIndex = frameNumber - 1`

**理由**: DB保存時点で時刻補正を確定させるため

---

### 4-6. 全グラフの時刻統一
**対象**: `backend/lib/dataProcessor.ts`, `components/Dashboard.tsx`

- `frame.realTimestamp` が補正済みであることを前提に、
  - `processedFrames.time` / `fullTimestamp` / `arrivalTrendData.time` の計算を確認
- `Dashboard.tsx` 側の `time` 表示に関しては **既存ロジックを維持**（補正済みの値が流れてくる）

**理由**: 補正がすべてのグラフに反映されるため

---

### 4-7. 横スクロール対応
**対象**: `components/Dashboard.tsx`

- 各チャートを `overflow-x-auto` でラップ
- 内側に `minWidth` を持つラッパーを追加し、幅不足時に横スクロール発生
- 対象は **全チャート**（時系列は必須）

**理由**: 横スクロール前提で全体を見られるようにするため

---

## 5. 具体的な修正箇所まとめ（ファイル単位）
- `components/FileUpload.tsx`
  - HH:MM:SS入力UI追加、バリデーション、onFileUploadSuccess引数追加
- `App.tsx`
  - upload init API の body に `recordingDuration` 追加
  - 固定 `recordingEndTime` の送信を削除
- `backend/app/api/videos/upload/init/route.ts`
  - schema に `recordingDuration`
  - `recordingEndTime` を start+duration で算出
- `backend/lib/timeConverter.ts`
  - `calculateLinearTimestamp` の追加
- `backend/app/api/videos/upload/chunk/route.ts`
  - `calculateLinearTimestamp` で `realTimestamp` を生成
- `components/Dashboard.tsx`
  - 全チャートに `overflow-x-auto + minWidth` を追加

## 6. 検証計画（手動）
- **時間補正**
  - 開始時刻 + `HH:MM:SS` が最終フレームの時刻と一致するか
- **表示確認**
  - 全チャートが横スクロール可能か
  - X軸ラベルが詰まってもスクロールで読めるか
- **性能確認**
  - 5時間データで描画が固まらないか

## 7. 未確定事項（確認が必要）
- `HH:MM:SS` の入力は **必須**で良いか
- `00:00:00` は拒否で良いか
- `frameNumber` の起点が 1 なのか 0 なのか（線形補正でのズレ防止）

---

以上の計画で要件を満たす見込みです。
問題なければ「実装して」と言ってください。
