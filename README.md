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

JSON ファイルは、フレームキーをトップレベルのキーとし、その値として各フレームで検出された人物情報の配列を持つオブジェクトである必要があります。

```json
{
  "フレームキー1": [検出データ配列],
  "フレームキー2": [検出データ配列],
  ...
}
```

### 検出データの必須項目

各検出データオブジェクトは、以下のフィールドを持つ必要があります。

| 項目                | 型             | 説明                                      | 例                        |
| :------------------ | :------------- | :---------------------------------------- | :------------------------ |
| `frame_number`      | number         | フレーム番号                              | `1`                       |
| `timestamp`         | string         | タイムスタンプ (YYYY-MM-DD HH:MM:SS)      | `"2025-06-19 19:12:30"`   |
| `person_id`         | string         | 一意の人物 ID                             | `"ID_001"`                |
| `bbox`              | number[]       | バウンディングボックス `[x1, y1, x2, y2]` | `[2732, 949, 3359, 1984]` |
| `raw_seat_id`       | string \| null | AI による未加工の座席 ID                  | `"right"`                 |
| `confirmed_seat_id` | string \| null | 確定した座席 ID（グループ分けに使用）     | `"table_1"`               |
| `seat_status`       | string         | 座席の状態 ("Unassigned", "Assigned"など) | `"Assigned"`              |
| `confidence`        | number         | 検出の信頼度スコア (0-1 の範囲)           | `0.9236`                  |

### 具体例

```json
{
  "frame_001": [
    {
      "frame_number": 1,
      "timestamp": "2025-06-19 19:12:30",
      "person_id": "ID_001",
      "bbox": [2732, 949, 3359, 1984],
      "raw_seat_id": "right",
      "confirmed_seat_id": "table_1",
      "seat_status": "Assigned",
      "confidence": 0.923641562461853
    },
    {
      "frame_number": 1,
      "timestamp": "2025-06-19 19:12:30",
      "person_id": "ID_002",
      "bbox": [0, 1469, 446, 1995],
      "raw_seat_id": null,
      "confirmed_seat_id": "table_1",
      "seat_status": "Assigned",
      "confidence": 0.9182910323143005
    },
    {
      "frame_number": 1,
      "timestamp": "2025-06-19 19:12:30",
      "person_id": "ID_003",
      "bbox": [319, 1528, 729, 1995],
      "raw_seat_id": null,
      "confirmed_seat_id": "table_2",
      "seat_status": "Assigned",
      "confidence": 0.8378861546516418
    }
  ],
  "frame_002": [
    {
      "frame_number": 2,
      "timestamp": "2025-06-19 19:12:32",
      "person_id": "ID_001",
      "bbox": [2735, 951, 3361, 1986],
      "raw_seat_id": "right",
      "confirmed_seat_id": "table_1",
      "seat_status": "Assigned",
      "confidence": 0.925
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
