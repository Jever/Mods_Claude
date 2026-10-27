import type { EngineInterface } from 'claude-code'

// Um modelo da lista de preços. O arquivo é relido a cada cálculo, então dá para editar os valores sem reiniciar.
export type CostModel = {
  id: string
  label: string
  usdPorMtokIn: number
  usdPorMtokOut: number
}

// Tokens acumulados de um modelo nesta sessão, na grafia do ModelUsage do SDK.
export type ModelTokens = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

// cache_read custa uma fração da entrada. A lista só tem Entrada/Saída, então o desconto é fixo.
export const CACHE_READ_FACTOR = 0.1

const SEED: readonly CostModel[] = [
  { id: 'kimi-k2.5', label: 'Kimi', usdPorMtokIn: 0.6, usdPorMtokOut: 3.0 },
  { id: 'glm-5.2-tencent-claude', label: 'GLM', usdPorMtokIn: 1.05, usdPorMtokOut: 3.3 },
  { id: 'gpt-6.1-sol', label: 'Sol', usdPorMtokIn: 2.0, usdPorMtokOut: 10.0 },
  { id: 'claude-opus-5.5-bedrock', label: 'Opus 5.5', usdPorMtokIn: 4.0, usdPorMtokOut: 20.0 },
  { id: 'gpt-6-luna', label: 'Luna', usdPorMtokIn: 0.1, usdPorMtokOut: 0.5 },
  { id: 'deepseek-v4-pro-claude', label: 'DeepSeek', usdPorMtokIn: 0.46, usdPorMtokOut: 1.39 },
  { id: 'claude-sonnet-5-bedrock', label: 'Sonnet 5', usdPorMtokIn: 2.0, usdPorMtokOut: 10.0 },
  { id: 'claude-haiku-4-5-20251001-v1.0', label: 'Haiku', usdPorMtokIn: 1.0, usdPorMtokOut: 5.0 },
]

const isValid = (m: unknown): m is CostModel => {
  if (typeof m !== 'object' || m === null) return false
  const o = m as Record<string, unknown>
  return (
    typeof o.id === 'string' && o.id.trim() !== '' &&
    typeof o.label === 'string' &&
    typeof o.usdPorMtokIn === 'number' && Number.isFinite(o.usdPorMtokIn) && o.usdPorMtokIn > 0 &&
    typeof o.usdPorMtokOut === 'number' && Number.isFinite(o.usdPorMtokOut) && o.usdPorMtokOut > 0
  )
}

// Lê a lista de preços. Um arquivo ausente é criado com a seed; um quebrado cai para a seed. Nunca lança.
export async function readModels($: EngineInterface, home: string): Promise<CostModel[]> {
  const path = `${home}/.claude/mods-state/cost-models.json`
  try {
    if (!(await $.fs.exists(path))) {
      await $.fs.write(path, `${JSON.stringify(SEED, null, 2)}\n`)
      return [...SEED]
    }
    const parsed: unknown = JSON.parse(String(await $.fs.read(path)))
    if (!Array.isArray(parsed)) return [...SEED]
    return parsed.filter(isValid)
  } catch {
    return [...SEED]
  }
}

// O modelo da lista que bate com o id, por id normalizado (minúsculas, sem espaços). undefined se não existe.
export function priceOf(models: readonly CostModel[], id: string): CostModel | undefined {
  const key = id.trim().toLowerCase()
  return models.find(m => m.id.trim().toLowerCase() === key)
}

// Custo em US$ de um acumulado de tokens, com o preço do modelo.
export function costOfTokens(tokens: ModelTokens, model: CostModel): number {
  const input = tokens.input_tokens + tokens.cache_creation_input_tokens
  const cacheRead = tokens.cache_read_input_tokens
  const output = tokens.output_tokens
  return (
    (input * model.usdPorMtokIn) / 1_000_000 +
    (cacheRead * CACHE_READ_FACTOR * model.usdPorMtokIn) / 1_000_000 +
    (output * model.usdPorMtokOut) / 1_000_000
  )
}
