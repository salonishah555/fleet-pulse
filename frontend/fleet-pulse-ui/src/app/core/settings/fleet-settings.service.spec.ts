import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { FleetSettingsService } from './fleet-settings.service';

describe('FleetSettingsService', () => {
  beforeEach(() => {
    localStorage.removeItem('fleet-pulse-settings');
    TestBed.configureTestingModule({ providers: [FleetSettingsService] });
  });

  afterEach(() => {
    localStorage.removeItem('fleet-pulse-settings');
    TestBed.resetTestingModule();
  });

  it('persists settings and applies the selected document color scheme', () => {
    const settings = TestBed.inject(FleetSettingsService);
    const document = TestBed.inject(DOCUMENT);
    settings.save({ refreshIntervalSec: 5, staleAfterSec: 20, colorScheme: 'light' });

    expect(settings.settings()).toEqual({ refreshIntervalSec: 5, staleAfterSec: 20, colorScheme: 'light' });
    expect(JSON.parse(localStorage.getItem('fleet-pulse-settings') ?? '{}')).toMatchObject({ refreshIntervalSec: 5 });
    expect(document.documentElement.dataset['colorScheme']).toBe('light');
  });

  it('applies a saved light scheme during application startup', () => {
    localStorage.setItem('fleet-pulse-settings', JSON.stringify({
      refreshIntervalSec: 2,
      staleAfterSec: 10,
      colorScheme: 'light',
    }));

    TestBed.inject(FleetSettingsService);

    expect(TestBed.inject(DOCUMENT).documentElement.dataset['colorScheme']).toBe('light');
  });
});
