import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { resilienceInterceptor } from './core/http/resilience.interceptor';
import { FleetSettingsService } from './core/settings/fleet-settings.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => {
      inject(FleetSettingsService);
    }),
    provideHttpClient(withInterceptors([authInterceptor, resilienceInterceptor])),
    provideRouter(routes),
  ],
};
