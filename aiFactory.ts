import { AI_CONFIG, AIProvider } from './aiConfig';
import { GeminiProvider, AnthropicProvider } from './aiProviders';

// AI Provider Factory
export function createAIProvider(): { provider: AIProvider | null, error: string | null } {
  try {
    switch (AI_CONFIG.provider) {
      case 'gemini': {
        const provider = new GeminiProvider();
        return {
          provider: provider.isAvailable() ? provider : null,
          error: provider.isAvailable() ? null : `Gemini provider not available. Please check GEMINI_API_KEY.`
        };
      }
      case 'anthropic': {
        const provider = new AnthropicProvider();
        return {
          provider: provider.isAvailable() ? provider : null,
          error: provider.isAvailable() ? null : `Anthropic provider not available. Please check ANTHROPIC_API_KEY.`
        };
      }
      default:
        return {
          provider: null,
          error: `Unknown AI provider: ${AI_CONFIG.provider}`
        };
    }
  } catch (error) {
    return {
      provider: null,
      error: `Failed to create AI provider: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Get current provider info for display
export function getProviderInfo(): { name: string, available: boolean, error?: string } {
  const { provider, error } = createAIProvider();
  
  if (provider) {
    return {
      name: provider.getProviderName(),
      available: true
    };
  }
  
  return {
    name: AI_CONFIG.provider === 'gemini' ? 'Gemini' : 'Anthropic',
    available: false,
    error: error || 'Unknown error'
  };
}
