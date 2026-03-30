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
 * フレーム番号を動画尺に均等配分して実時刻を計算
 * @param recordingStartTime 撮影開始時刻
 * @param durationSeconds 動画尺（秒）
 * @param frameIndex 0始まりのフレームindex
 * @param totalFrames 総フレーム数
 */
export function calculateLinearTimestamp(
  recordingStartTime: Date,
  durationSeconds: number,
  frameIndex: number,
  totalFrames: number
): Date {
  const denominator = Math.max(totalFrames - 1, 1);
  const ratio = frameIndex / denominator;
  const timestamp = new Date(recordingStartTime.getTime() + ratio * durationSeconds * 1000);
  return timestamp;
}

/**
 * JSONデータからFPSを推定
 * 例: 2025/06/30 10:00:00 ～ 15:06:00 (約5時間) のデータから逆算
 * @param jsonData フレームデータ
 * @param recordingStartTime 撮影開始時刻（オプション）
 * @param recordingEndTime 撮影終了時刻（オプション）
 */
export function estimateFps(
  jsonData: Record<string, any[]>,
  recordingStartTime?: Date,
  recordingEndTime?: Date
): number {
  const frameKeys = Object.keys(jsonData);
  const totalFrames = frameKeys.length;
  
  if (recordingStartTime && recordingEndTime) {
    // 開始時刻と終了時刻から計算
    const durationSeconds = (recordingEndTime.getTime() - recordingStartTime.getTime()) / 1000;
    return totalFrames / durationSeconds;
  }
  
  // デフォルト: 30 FPS と仮定
  return 30;
}

/**
 * タイムスタンプ文字列をDateオブジェクトに変換
 * @param timestampStr "YYYY-MM-DD HH:MM:SS" 形式の文字列
 */
export function parseTimestamp(timestampStr: string): Date {
  // "YYYY-MM-DD HH:MM:SS" → Date
  const [datePart, timePart] = timestampStr.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, second] = timePart.split(':').map(Number);
  
  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * "HH:MM:SS" を秒に変換
 */
export function parseDurationHms(durationStr: string): number {
  const [h, m, s] = durationStr.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}
