// Vite環境変数の型定義
interface ImportMetaEnv {
  readonly VITE_GEMINI_API_KEY?: string;
  readonly VITE_API_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  [key: string]: any;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// AI Provider Configuration
export const AI_CONFIG = {
  // プロバイダーを選択: 'gemini' | 'anthropic'
  provider: 'anthropic' as 'gemini' | 'anthropic',
  
  gemini: {
    // Viteでは VITE_ プレフィックスが必要
    apiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.VITE_API_KEY,
    model: 'gemini-2.5-flash-preview-04-17'
  },
  
  anthropic: {
    apiKey: (import.meta as any).env?.VITE_ANTHROPIC_API_KEY,
    model: 'claude-3-5-sonnet-20241022'
  }
};

// デバッグ用: 環境変数の状況をログ出力
console.log('AI Config Debug:', {
  provider: AI_CONFIG.provider,
  viteAnthropicKey: (import.meta as any).env?.VITE_ANTHROPIC_API_KEY,
  anthropicKeyExists: !!(import.meta as any).env?.VITE_ANTHROPIC_API_KEY,
  viteGeminiKey: (import.meta as any).env?.VITE_GEMINI_API_KEY,
  geminiKeyExists: !!((import.meta as any).env?.VITE_GEMINI_API_KEY || (import.meta as any).env?.VITE_API_KEY),
  allViteEnv: (import.meta as any).env
});

// AI Provider Interface
export interface AIProvider {
  generateSuggestions(prompt: string): Promise<string>;
  isAvailable(): boolean;
  getProviderName(): string;
}
