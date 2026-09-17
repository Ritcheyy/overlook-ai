import type { PersistedState, StorePort } from '../ports'

export class MemoryStore implements StorePort {
  state: PersistedState | null = null
  saves = 0

  constructor(initial: PersistedState | null = null) {
    this.state = initial
  }

  async load(): Promise<PersistedState | null> {
    return this.state ? structuredClone(this.state) : null
  }

  async save(state: PersistedState): Promise<void> {
    this.saves++
    this.state = structuredClone(state)
  }
}
