# Restaurant Occupancy Dashboard

レストランの占有データを可視化し、顧客パターンの分析と運営最適化を支援するダッシュボードアプリケーションです。

## Features

- 📊 リアルタイム顧客数・テーブル占有率の表示
- 📈 時系列での顧客数推移グラフ
- 🪑 座席ごとの占有状況の可視化
- 👥 グループサイズ分布の分析
- 🤖 AI による運営改善提案（Gemini API 使用）

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## データファイル形式

このアプリケーションで分析可能な JSON ファイルの形式について説明します。

### 基本構造

```json
{
  "フレームキー1": [検出データ配列],
  "フレームキー2": [検出データ配列],
  "フレームキー3": [検出データ配列]
}
```

### 検出データの必須項目

各フレームの検出データ配列には、以下の項目を持つオブジェクトが含まれている必要があります：

| 項目            | 型       | 説明                                    | 例                      |
| --------------- | -------- | --------------------------------------- | ----------------------- |
| `ID`            | number   | 検出 ID                                 | `1`                     |
| `Name`          | string   | 人物名                                  | `"person1"`             |
| `Class`         | number   | クラス番号                              | `0`                     |
| `Score`         | number   | 検出スコア（0-1）                       | `0.95`                  |
| `BBox`          | number[] | バウンディングボックス [x1, y1, x2, y2] | `[100, 200, 150, 300]`  |
| `Time`          | string   | タイムスタンプ（YYYY-MM-DD HH:MM:SS）   | `"2023-12-01 12:00:00"` |
| `Total`         | number   | このフレームの総検出数                  | `3`                     |
| `TotalPerson`   | number   | このフレームの総人数                    | `3`                     |
| `DetectedCount` | number   | 累積検出カウンター                      | `1`                     |
| `SeatID`        | string   | 座席 ID                                 | `"table1"`              |
| `SeatConfirmed` | boolean  | 座席確認フラグ                          | `true`                  |

### 具体例

```json
{
  "frame_001": [
    {
      "ID": 1,
      "Name": "person1",
      "Class": 0,
      "Score": 0.95,
      "BBox": [100, 200, 150, 300],
      "Time": "2023-12-01 12:00:00",
      "Total": 3,
      "TotalPerson": 3,
      "DetectedCount": 1,
      "SeatID": "table1",
      "SeatConfirmed": true
    },
    {
      "ID": 2,
      "Name": "person2",
      "Class": 0,
      "Score": 0.88,
      "BBox": [200, 250, 250, 350],
      "Time": "2023-12-01 12:00:00",
      "Total": 3,
      "TotalPerson": 3,
      "DetectedCount": 2,
      "SeatID": "table1",
      "SeatConfirmed": true
    }
  ],
  "frame_002": [
    {
      "ID": 3,
      "Name": "person3",
      "Class": 0,
      "Score": 0.92,
      "BBox": [300, 150, 350, 250],
      "Time": "2023-12-01 12:00:30",
      "Total": 1,
      "TotalPerson": 1,
      "DetectedCount": 1,
      "SeatID": "table2",
      "SeatConfirmed": true
    }
  ]
}
```

### 重要な注意点

- ✅ ファイル拡張子は `.json` である必要があります
- ✅ `Time` フィールドは「YYYY-MM-DD HH:MM:SS」形式で記載してください
- ✅ `SeatID` はテーブルや座席を識別するユニークな文字列です（例：table1, table2, seat_A1 など）
- ✅ 検出データが空の配列のフレームは自動的に除外されます
- ✅ アップロード時に基本的な構造チェックが行われます

この形式に従った JSON ファイルをアップロードすることで、レストランの顧客分析、座席占有率の推移、グループサイズの分布などの詳細な分析が可能になります。
