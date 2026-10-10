import { EventEmitter } from 'node:events';
import type { ChaosState } from './types.js';

export const defaultChaos: ChaosState = {
  rate: 500,
  chaos: [],
  token_ttl: 60,
};

export class ChaosService extends EventEmitter {
  private state: ChaosState = { ...defaultChaos, chaos: [] };

  get(): ChaosState {
    return { ...this.state, chaos: [...this.state.chaos] };
  }

  merge(input: Record<string, unknown>): ChaosState {
    const next = { ...this.state, chaos: [...this.state.chaos] };

    if (input['rate'] !== undefined) {
      const rate = Number(input['rate']);
      if (Number.isFinite(rate)) next.rate = Math.min(5000, Math.max(1, Math.trunc(rate)));
    }
    if (input['ws'] === 'down' || input['ws'] === 'silent') next.ws = input['ws'];
    if (input['ws'] === null || input['ws'] === '') delete next.ws;
    if (input['sse'] === 'down') next.sse = 'down';
    if (input['sse'] === null || input['sse'] === '') delete next.sse;
    if (typeof input['chaos'] === 'string') {
      next.chaos = input['chaos'].split(',').map((value) => value.trim()).filter(Boolean);
    } else if (Array.isArray(input['chaos'])) {
      next.chaos = input['chaos'].map(String);
    }
    if (input['token_ttl'] !== undefined) {
      const ttl = Number(input['token_ttl']);
      if (Number.isFinite(ttl)) next.token_ttl = Math.max(1, Math.trunc(ttl));
    }
    if (typeof input['http'] === 'string') next.http = input['http'];
    if (input['http'] === null || input['http'] === '') delete next.http;
    if (input['kill'] !== undefined) {
      const kill = Number(input['kill']);
      if (Number.isFinite(kill) && kill > 0) next.kill = Math.trunc(kill);
    }
    if (input['kill'] === null || input['kill'] === '') delete next.kill;

    this.state = next;
    this.emit('change', this.get());
    return this.get();
  }

  reset(): ChaosState {
    this.state = { ...defaultChaos, chaos: [] };
    this.emit('change', this.get());
    return this.get();
  }

  fromQuery(query: Record<string, unknown>): Partial<ChaosState> {
    const parsed = new ChaosService();
    parsed.merge(this.get() as unknown as Record<string, unknown>);
    parsed.merge(query);
    return parsed.get();
  }

  shouldGarbage(local: Partial<ChaosState>): boolean {
    return this.percentSwitch(local, 'garbage');
  }

  shouldDrop(local: Partial<ChaosState>): boolean {
    const drop = local.ws?.startsWith('drop:') ? local.ws : undefined;
    const pct = drop ? Number(drop.split(':')[1]) : this.switchPercent(local, 'drop');
    return Number.isFinite(pct) && Math.random() * 100 < pct;
  }

  hasFlag(local: Partial<ChaosState>, flag: string): boolean {
    return (local.chaos ?? []).some((value) => value === flag);
  }

  private percentSwitch(local: Partial<ChaosState>, prefix: string): boolean {
    const pct = this.switchPercent(local, prefix);
    return Number.isFinite(pct) && Math.random() * 100 < pct;
  }

  private switchPercent(local: Partial<ChaosState>, prefix: string): number {
    const value = (local.chaos ?? []).find((entry) => entry.startsWith(`${prefix}:`));
    return value ? Number(value.split(':')[1]) : Number.NaN;
  }
}

export const chaosService = new ChaosService();
