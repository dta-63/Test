import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthModule, AuthHttpInterceptor } from '@auth0/auth0-angular';

import { env } from './env';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    importProvidersFrom(
      AuthModule.forRoot({
        domain: env.auth0Domain,
        clientId: env.auth0ClientId,
        authorizationParams: {
          redirect_uri: window.location.origin,
          audience: env.auth0Audience,
        },
        httpInterceptor: {
          allowedList: [`${env.apiUrl}/api/*`],
        },
      }),
    ),
    { provide: HTTP_INTERCEPTORS, useClass: AuthHttpInterceptor, multi: true },
  ],
};
