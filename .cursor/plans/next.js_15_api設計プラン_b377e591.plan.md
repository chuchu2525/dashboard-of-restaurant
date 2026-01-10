---
name: Next.js 15 API設計プラン
overview: 既存のReact + Viteフロントエンドを維持しつつ、Next.js 15のRoute HandlersをバックエンドAPIサーバーとして追加。PostgreSQLで過去データの保存・検索・複数日付比較を実現する。
todos:
  - id: setup-nextjs
    content: Next.js 15プロジェクト作成とPrismaセットアップ
    status: completed
  - id: setup-postgres
    content: PostgreSQL起動とPrismaスキーマ定義・マイグレーション
    status: completed
  - id: implement-upload-api
    content: JSONアップロードAPIと実時刻変換ロジック実装
    status: completed
  - id: implement-data-api
    content: データ取得APIとダッシュボード形式変換実装
    status: completed
  - id: cors-setup
    content: Next.js CORS設定とAPI疎通確認
    status: completed
  - id: frontend-integration
    content: React App.tsxをAPI呼び出しに変更
    status: completed
  - id: comparison-api
    content: 複数動画比較API実装
    status: completed
---

# Next.js 15 バックエンドAPI + PostgreSQL設計プラン

## 1. アーキテクチャ概要

既存のReact + Viteフロントエンドはそのまま維持し、Next.js 15を**純粋なAPIサーバー**として追加します。

```mermaid
graph TB
    subgraph Frontend[フロントエンド React Vite port5173]
        ReactUI[Dashboard UI]
        FileUpload[File Upload]
    end
    
    subgraph Backend[Next.js15 APIサーバー port3000]
        RouteHandlers[Route Handlers]
        TimeConverter[実時刻変換]
        DataProcessor[データ処理]
    end
    
    subgraph Database[PostgreSQL port5432]
        Videos[videos table]
        Frames[frames table]
        Detections[detections table]
    end
    
    ReactUI -->|fetch GET /api/videos| RouteHandlers
    FileUpload -->|fetch POST /api/videos/upload| RouteHandlers
    RouteHandlers --> TimeConverter
    TimeConverter --> DataProcessor
    DataProcessor -->|Prisma ORM| Database
```



## 2. プロジェクト構造

```javascript
dashboard-feature/
├── xcp/                           # 既存: React + Vite フロントエンド
│   ├── src/
│   ├── components/
│   │   ├── Dashboard.tsx          # 既存コンポーネント（一部API統合）
│   │   └── FileUpload.tsx
│   ├── App.tsx                    # fetch APIに変更
│   ├── types.ts                   # バックエンドと共有可能
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                       # 新規: Next.js 15 APIサーバー
│   ├── app/
│   │   └── api/                   # Route Handlers
│   │       ├── videos/
│   │       │   ├── route.ts       # GET/POST /api/videos
│   │       │   ├── upload/
│   │       │   │   └── route.ts   # POST /api/videos/upload
│   │       │   └── [id]/
│   │       │       ├── route.ts   # GET /api/videos/:id
│   │       │       └── data/
│   │       │           └── route.ts  # GET /api/videos/:id/data
│   │       └── compare/
│   │           └── route.ts       # GET /api/compare
│   ├── lib/
│   │   ├── prisma.ts              # Prismaクライアント
│   │   ├── timeConverter.ts       # 実時刻変換ロジック
│   │   └── dataProcessor.ts       # データ集計処理
│   ├── prisma/
│   │   └── schema.prisma          # DBスキーマ定義
│   ├── types/
│   │   └── api.ts                 # API型定義
│   ├── package.json
│   ├── next.config.ts             # CORS設定
│   └── tsconfig.json
│
├── docker-compose.yml             # PostgreSQL + 開発環境
└── README.md
```



## 3. データベース設計（PostgreSQL + Prisma）

### Prismaスキーマ

```prisma
// backend/prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Video {
  id                   String    @id @default(uuid())
  filename             String
  recordingStartTime   DateTime
  recordingEndTime     DateTime?
  videoFps             Float?
  totalFrames          Int?
  processedFrames      Int?
  uploadedAt           DateTime  @default(now())
  metadata             Json?
  
  frames               Frame[]
  
  @@index([recordingStartTime])
}

model Frame {
  id              String    @id @default(uuid())
  videoId         String
  frameNumber     Int
  realTimestamp   DateTime
  totalPersons    Int
  occupiedSeats   Int
  
  video           Video     @relation(fields: [videoId], references: [id], onDelete: Cascade)
  detections      Detection[]
  
  @@unique([videoId, frameNumber])
  @@index([realTimestamp])
  @@index([videoId])
}

model Detection {
  id          String  @id @default(uuid())
  frameId     String
  personId    String
  bboxX1      Int
  bboxY1      Int
  bboxX2      Int
  bboxY2      Int
  seatId      String?
  confidence  Float
  
  frame       Frame   @relation(fields: [frameId], references: [id], onDelete: Cascade)
  
  @@index([personId])
  @@index([frameId])
}
```



## 4. Next.js 15 APIエンドポイント設計

### API一覧

| メソッド | エンドポイント | 説明 ||---------|--------------|------|| POST | `/api/videos/upload` | JSONファイルアップロード || GET | `/api/videos` | 動画一覧取得 || GET | `/api/videos/:id` | 動画メタデータ取得 || GET | `/api/videos/:id/data` | 分析データ取得（ダッシュボード用） || GET | `/api/compare?videoIds=x,y` | 複数動画比較データ |

### 実装例

#### 1. アップロードAPI

```typescript
// backend/app/api/videos/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRealTimestamp } from '@/lib/timeConverter';
import { z } from 'zod';

const uploadSchema = z.object({
  jsonData: z.record(z.array(z.any())),
  filename: z.string(),
  recordingStartTime: z.string(),
  videoFps: z.number().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jsonData, filename, recordingStartTime, videoFps } = uploadSchema.parse(body);
    
    // FPS推定（提供されない場合）
    const fps = videoFps || estimateFps(jsonData);
    const startTime = new Date(recordingStartTime);
    
    // Videoレコード作成
    const video = await prisma.video.create({
      data: {
        filename,
        recordingStartTime: startTime,
        videoFps: fps,
      },
    });
    
    // フレームデータを一括挿入
    const frameData = Object.entries(jsonData).map(([frameKey, detections]) => {
      const frameNumber = parseInt(frameKey.replace('frame_', ''));
      const realTimestamp = calculateRealTimestamp(startTime, frameNumber, fps);
      
      return {
        videoId: video.id,
        frameNumber,
        realTimestamp,
        totalPersons: detections.length,
        occupiedSeats: new Set(detections.map(d => d.seat_id).filter(Boolean)).size,
        detections: {
          create: detections.map(det => ({
            personId: det.person_id,
            bboxX1: det.bbox[0],
            bboxY1: det.bbox[1],
            bboxX2: det.bbox[2],
            bboxY2: det.bbox[3],
            seatId: det.confirmed_seat_id,
            confidence: det.confidence,
          })),
        },
      };
    });
    
    await prisma.frame.createMany({ data: frameData });
    
    return NextResponse.json({ 
      success: true, 
      videoId: video.id 
    });
    
  } catch (error) {
    return NextResponse.json(
      { error: 'Upload failed', details: error.message },
      { status: 400 }
    );
  }
}
```



#### 2. データ取得API

```typescript
// backend/app/api/videos/[id]/data/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { processFramesForDashboard } from '@/lib/dataProcessor';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const videoId = params.id;
  
  // フレームと検出データを取得
  const frames = await prisma.frame.findMany({
    where: { videoId },
    include: { detections: true },
    orderBy: { frameNumber: 'asc' },
  });
  
  // 既存のダッシュボード形式に変換
  const dashboardData = processFramesForDashboard(frames);
  
  return NextResponse.json(dashboardData);
}
```



#### 3. 実時刻変換ロジック

```typescript
// backend/lib/timeConverter.ts

/**
    * フレーム番号から実時刻を計算
    * @param recordingStartTime 撮影開始時刻
    * @param frameNumber フレーム番号
    * @param fps フレームレート
 */
export function calculateRealTimestamp(
  recordingStartTime: Date,
  frameNumber: number,
  fps: number
): Date {
  const elapsedSeconds = frameNumber / fps;
  const timestamp = new Date(recordingStartTime.getTime() + elapsedSeconds * 1000);
  return timestamp;
}

/**
    * JSONデータからFPSを推定
    * 例: 2025/06/30 10:00:00 ～ 15:06:00 (約5時間) のデータから逆算
 */
export function estimateFps(jsonData: Record<string, any[]>): number {
  const frameKeys = Object.keys(jsonData);
  const totalFrames = frameKeys.length;
  
  // タイムスタンプから期間を計算（fallback）
  // 実際の実装では、ユーザー入力の終了時刻を使用
  const estimatedDurationSeconds = 5 * 60 * 60; // 5時間
  return totalFrames / estimatedDurationSeconds;
}
```



## 5. CORS設定（Next.js 15）

```typescript
// backend/next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'http://localhost:5173' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
```



## 6. フロントエンド統合（最小限の変更）

### App.tsx の変更

```typescript
// xcp/App.tsx
const handleFileUpload = useCallback(async (
  jsonString: string, 
  name: string, 
  startTime: string
) => {
  setIsLoading(true);
  setError(null);
  
  try {
    // バックエンドAPIにアップロード
    const response = await fetch('http://localhost:3000/api/videos/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonData: JSON.parse(jsonString),
        filename: name,
        recordingStartTime: startTime,
      }),
    });
    
    if (!response.ok) throw new Error('Upload failed');
    
    const { videoId } = await response.json();
    
    // ダッシュボード用データ取得
    const dataResponse = await fetch(`http://localhost:3000/api/videos/${videoId}/data`);
    const dashboardData = await dataResponse.json();
    
    setProcessedFrames(dashboardData.processedFrames);
    setSummaryMetrics(dashboardData.summaryMetrics);
    // ... 他のstate更新
    setHasData(true);
    
  } catch (err) {
    setError(err.message);
  } finally {
    setIsLoading(false);
  }
}, []);
```



### 環境変数設定

```typescript
// xcp/.env.local
VITE_API_URL=http://localhost:3000
```



```typescript
// xcp/App.tsx
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
```



## 7. 開発環境セットアップ（Docker Compose）

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: restaurant_user
      POSTGRES_PASSWORD: restaurant_pass
      POSTGRES_DB: restaurant_dashboard
    ports:
                        - "5432:5432"
    volumes:
                        - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./backend
    ports:
                        - "3000:3000"
    environment:
      DATABASE_URL: postgresql://restaurant_user:restaurant_pass@postgres:5432/restaurant_dashboard
    depends_on:
                        - postgres
    volumes:
                        - ./backend:/app
                        - /app/node_modules

volumes:
  postgres_data:
```



## 8. 実装手順

### フェーズ1: バックエンド基盤構築

1. Next.js 15プロジェクト作成（`npx create-next-app@latest backend`）
2. Prismaセットアップ（`npm install prisma @prisma/client`）
3. PostgreSQL起動（Docker Compose）
4. Prismaマイグレーション実行

### フェーズ2: API実装

1. `/api/videos/upload` 実装
2. 実時刻変換ロジック実装
3. `/api/videos/:id/data` 実装
4. データ処理・集計ロジック実装

### フェーズ3: フロントエンド統合

1. 環境変数設定
2. `App.tsx`のアップロード処理をAPI呼び出しに変更
3. 動画一覧表示機能追加（オプション）

### フェーズ4: 高度な機能

1. 複数動画比較API実装
2. 日付範囲フィルタリング
3. パフォーマンス最適化

## 9. Pythonスクリプト改善（オプション）

[`video_gallery_tracker_seat.py`](/Users/yuukun/Documents/Project/univ/iio-semi/restaurant/analysis-restaurant/yolov8/video_gallery_tracker_seat.py) に引数追加:

```python
# 追加
ap.add_argument("--recording-start-time", type=str, 
                help="実際の撮影開始時刻 (YYYY-MM-DD HH:MM:SS)")

# 612行目付近を修正
if args.recording_start_time:
    video_start = datetime.strptime(args.recording_start_time, "%Y-%m-%d %H:%M:%S")
    elapsed_seconds = frame_num / fps
    current_time = (video_start + timedelta(seconds=elapsed_seconds)).strftime("%Y-%m-%d %H:%M:%S")
else:
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
```

実行例:

```bash
python video_gallery_tracker_seat.py \
  --video input.mp4 \
  --recording-start-time "2025-06-30 10:00:00" \
  --output-json track_seat_output.json
```



## 10. デプロイオプション

### ローカル開発

```bash
# PostgreSQL起動
docker-compose up -d postgres

# バックエンド起動
cd backend && npm run dev  # port 3000

# フロントエンド起動
cd xcp && npm run dev      # port 5173
```



### 本番環境（オプション）

- **Next.js**: Vercel / Railway / AWS
- **PostgreSQL**: Supabase / Neon / AWS RDS