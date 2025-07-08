import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import Anthropic from '@anthropic-ai/sdk';
import { AI_CONFIG, AIProvider } from './aiConfig';

// Gemini Provider Implementation
export class GeminiProvider implements AIProvider {
  private client: GoogleGenAI | null = null;
  private initializationError: string | null = null;

  constructor() {
    try {
      const apiKey = AI_CONFIG.gemini.apiKey;
      if (apiKey) {
        this.client = new GoogleGenAI({ apiKey });
      } else {
        this.initializationError = "GEMINI_API_KEY environment variable not set.";
      }
    } catch (e) {
      this.initializationError = `Failed to initialize GoogleGenAI: ${e instanceof Error ? e.message : String(e)}`;
      console.error(this.initializationError);
    }
  }

  async generateSuggestions(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error(this.initializationError || "Gemini client not initialized");
    }

    try {
      const response: GenerateContentResponse = await this.client.models.generateContent({
        model: AI_CONFIG.gemini.model,
        contents: prompt,
      });
      return response.text ?? '';
    } catch (error) {
      throw new Error(`Gemini API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  isAvailable(): boolean {
    return this.client !== null && this.initializationError === null;
  }

  getProviderName(): string {
    return 'Gemini';
  }
}

// Anthropic Provider Implementation
export class AnthropicProvider implements AIProvider {
  private client: Anthropic | null = null;
  private initializationError: string | null = null;

  constructor() {
    try {
      const apiKey = AI_CONFIG.anthropic.apiKey;
      if (apiKey) {
        this.client = new Anthropic({ 
          apiKey,
          dangerouslyAllowBrowser: true // ブラウザ環境での実行を許可
        });
      } else {
        this.initializationError = "ANTHROPIC_API_KEY environment variable not set.";
      }
    } catch (e) {
      this.initializationError = `Failed to initialize Anthropic: ${e instanceof Error ? e.message : String(e)}`;
      console.error(this.initializationError);
    }
  }

  async generateSuggestions(prompt: string): Promise<string> {
    if (!this.client) {
      throw new Error(this.initializationError || "Anthropic client not initialized");
    }

    try {
      const response = await this.client.messages.create({
        model: AI_CONFIG.anthropic.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Anthropic APIのレスポンス形式に対応
      if (response.content && response.content.length > 0) {
        const firstContent = response.content[0];
        if (firstContent.type === 'text') {
          return firstContent.text;
        }
      }
      return '';
    } catch (error) {
      throw new Error(`Anthropic API error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  isAvailable(): boolean {
    return this.client !== null && this.initializationError === null;
  }

  getProviderName(): string {
    return 'Anthropic (Claude)';
  }
}
