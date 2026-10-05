// Cliente de Ollama Cloud. Habla el protocolo nativo (/api/chat en NDJSON) porque es el
// que expone razonamiento, herramientas y niveles de `think` tal como los documenta Ollama.

export type OllamaErrorCode = 'ollama_key_rejected' | 'ollama_rate_limited' | 'ollama_unavailable' | 'ollama_bad_request';

export class OllamaError extends Error {
  constructor(public readonly code: OllamaErrorCode, message: string, public readonly status?: number) {
    super(message);
    this.name = 'OllamaError';
  }
}

export type ThinkValue = string | boolean;

export interface OllamaModel {
  name: string;
  capabilities: string[];
  /** Valores que el modelo admite en `think`; nulo si no los declara. */
  thinking: { values: ThinkValue[]; default: ThinkValue | null } | null;
}

export interface ToolCall {
  type?: 'function';
  function: { index?: number; name: string; arguments: Record<string, unknown> };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  think?: ThinkValue;
}

export interface ChatChunk {
  message?: { role?: string; content?: string; thinking?: string; tool_calls?: ToolCall[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

const METADATA_TIMEOUT_MS = 20_000;

export class Ollama {
  private readonly base: string;

  constructor(baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private fail(status: number, body: string): OllamaError {
    const detail = body.slice(0, 300);
    if (status === 401 || status === 403) return new OllamaError('ollama_key_rejected', 'Ollama rechazó la clave.', status);
    if (status === 429) return new OllamaError('ollama_rate_limited', 'Ollama limitó las peticiones de esta clave.', status);
    if (status >= 400 && status < 500) return new OllamaError('ollama_bad_request', `Ollama no aceptó la petición: ${detail}`, status);
    return new OllamaError('ollama_unavailable', `Ollama respondió ${status}: ${detail}`, status);
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(`${this.base}${path}`, init);
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      throw new OllamaError('ollama_unavailable', `No se pudo contactar con Ollama: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  /** Nombres de los modelos disponibles. La lista es pública: no demuestra que una clave sirva. */
  async listModels(): Promise<string[]> {
    const res = await this.request('/api/tags', { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
    if (!res.ok) throw this.fail(res.status, await res.text());
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  }

  async showModel(name: string): Promise<OllamaModel> {
    const res = await this.request('/api/show', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (!res.ok) throw this.fail(res.status, await res.text());
    const body = (await res.json()) as { capabilities?: string[]; thinking?: { values?: ThinkValue[]; default?: ThinkValue } };
    return {
      name,
      capabilities: body.capabilities ?? [],
      thinking: body.thinking?.values ? { values: body.thinking.values, default: body.thinking.default ?? null } : null,
    };
  }

  /**
   * Comprueba una clave contra /api/me, que exige credenciales.
   * - 'valid': Ollama la aceptó.
   * - 'unverified': el servidor no ofrece esa ruta (un Ollama local, por ejemplo).
   * Lanza OllamaError('ollama_key_rejected') si la rechaza.
   */
  async validateKey(apiKey: string): Promise<'valid' | 'unverified'> {
    const res = await this.request('/api/me', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (res.ok) return 'valid';
    if (res.status === 404 || res.status === 405) return 'unverified';
    throw this.fail(res.status, await res.text());
  }

  /** Conversación en streaming: entrega cada línea NDJSON conforme llega. */
  async *chat(apiKey: string, request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatChunk> {
    const res = await this.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ ...request, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) throw this.fail(res.status, await res.text());

    const decoder = new TextDecoder();
    let buffer = '';
    const parse = (line: string): ChatChunk | null => {
      const text = line.trim();
      if (!text) return null;
      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(text) as ChatChunk;
      } catch {
        throw new OllamaError('ollama_unavailable', 'Ollama envió una línea que no es JSON.');
      }
      if (chunk.error) throw new OllamaError('ollama_unavailable', `Ollama interrumpió la respuesta: ${chunk.error}`);
      return chunk;
    };

    for await (const bytes of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const chunk = parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (chunk) yield chunk;
        newline = buffer.indexOf('\n');
      }
    }
    const last = parse(buffer + decoder.decode());
    if (last) yield last;
  }
}
