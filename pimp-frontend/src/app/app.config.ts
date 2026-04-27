import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import { AuthModule, AuthHttpInterceptor } from '@auth0/auth0-angular';

import { env, isAuth0Configured } from './env';
import { routes } from './app.routes';

// Auth0Client throws on construction if domain/clientId are empty. When the
// stack is started without a real .env, fall back to harmless placeholders so
// the SPA still bootstraps and renders the "Auth0 non configuré" banner
// instead of crashing in a way that's hard to diagnose.
const auth0Domain = isAuth0Configured() ? env.auth0Domain : 'pimp-not-configured.auth0.com';
const auth0ClientId = isAuth0Configured() ? env.auth0ClientId : 'not-configured';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withInterceptorsFromDi()),
    importProvidersFrom(
      AuthModule.forRoot({
        domain: auth0Domain,
        clientId: auth0ClientId,
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
