export type Clock = {
  /** Quando a última resposta da thread principal terminou, em ms. 0 antes da primeira resposta. */
  lastEnd: number
  /** Por quanto tempo o cache fica quente depois de uma resposta, em ms. */
  ttlMs: number
  /** detected: lido do log deste chat. default: estimativa de 5 min. */
  ttlSource: 'detected' | 'default'
  /** Tokens de contexto que a próxima mensagem reenvia. */
  tokens: number
  /** Último tick do relógio, em ms, para a faixa redesenhar a cada segundo. */
  now: number
}

export type Warm = {
  /** Quando o manter aquecido foi ligado, em ms: para sozinho 2 horas depois. */
  startedAt: number
  /** Pings enviados até agora: para sozinho depois de 30. */
  pings: number
  /** Tokens lidos do cache no último ping. */
  read: number
  /** Tokens gravados no cache no último ping. */
  write: number
  /** True quando o último ping gravou o chat no cache de novo: ele tinha esfriado. */
  cold: boolean
  /** Por que o último ping falhou, ou ''. */
  error: string
  /** True enquanto um ping está em andamento. */
  sending: boolean
  /** Pings que falharam seguidos: para depois de 3. */
  failures: number
  /** Nenhum ping novo antes deste momento, em ms (depois de uma falha). */
  retryAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'cache-keeper': { isBusy: boolean; clock: Clock | null; warm: Warm | null }
  }
}
