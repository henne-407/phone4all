/** Ersatz für „node:events“: kleiner EventEmitter für den geteilten Code. */

type Listener = (...args: never[]) => void

export class EventEmitter {
  private handlers = new Map<string | symbol, Set<Listener>>()

  on(name: string | symbol, listener: Listener): this {
    let set = this.handlers.get(name)
    if (!set) this.handlers.set(name, (set = new Set()))
    set.add(listener)
    return this
  }

  off(name: string | symbol, listener: Listener): this {
    this.handlers.get(name)?.delete(listener)
    return this
  }

  removeListener(name: string | symbol, listener: Listener): this {
    return this.off(name, listener)
  }

  once(name: string | symbol, listener: Listener): this {
    const wrapped = (...args: never[]): void => {
      this.off(name, wrapped)
      listener(...args)
    }
    return this.on(name, wrapped)
  }

  emit(name: string | symbol, ...args: unknown[]): boolean {
    const set = this.handlers.get(name)
    if (!set?.size) return false
    for (const l of [...set]) (l as (...a: unknown[]) => void)(...args)
    return true
  }
}

export default { EventEmitter }
