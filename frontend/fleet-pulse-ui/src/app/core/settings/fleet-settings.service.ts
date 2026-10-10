import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';

export interface FleetSettings {
  refreshIntervalSec: number;
  staleAfterSec: number;
  colorScheme: 'dark' | 'light';
}

export const defaultFleetSettings: FleetSettings = {
  refreshIntervalSec: 2,
  staleAfterSec: 10,
  colorScheme: 'dark',
};

@Injectable({ providedIn: 'root' })
export class FleetSettingsService {
  private readonly document = inject(DOCUMENT);
  readonly settings = signal(this.restore());

  constructor() {
    this.applyColorScheme(this.settings().colorScheme);
  }

  save(candidate: FleetSettings): void {
    const settings = normalizeSettings(candidate);
    localStorage.setItem('fleet-pulse-settings', JSON.stringify(settings));
    this.settings.set(settings);
    this.applyColorScheme(settings.colorScheme);
  }

  private restore(): FleetSettings {
    if (typeof localStorage === 'undefined') return { ...defaultFleetSettings };
    const raw = localStorage.getItem('fleet-pulse-settings');
    if (!raw) return { ...defaultFleetSettings };
    try {
      return normalizeSettings(JSON.parse(raw) as Partial<FleetSettings>);
    } catch (error) {
      localStorage.removeItem('fleet-pulse-settings');
      console.error('Unable to restore Fleet Pulse display preferences.', error);
      return { ...defaultFleetSettings };
    }
  }

  private applyColorScheme(colorScheme: FleetSettings['colorScheme']): void {
    this.document.documentElement.dataset['colorScheme'] = colorScheme;
  }
}

function normalizeSettings(value: Partial<FleetSettings>): FleetSettings {
  return {
    refreshIntervalSec: validNumber(value.refreshIntervalSec, 1, 30, defaultFleetSettings.refreshIntervalSec),
    staleAfterSec: validNumber(value.staleAfterSec, 5, 300, defaultFleetSettings.staleAfterSec),
    colorScheme: value.colorScheme === 'light' ? 'light' : 'dark',
  };
}

function validNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
