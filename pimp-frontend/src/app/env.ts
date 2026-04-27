export interface PimpEnv {
  auth0Domain: string;
  auth0ClientId: string;
  auth0Audience: string;
  apiUrl: string;
}

declare global {
  interface Window {
    __pimp_env__?: PimpEnv;
  }
}

export const env: PimpEnv = window.__pimp_env__ ?? {
  auth0Domain: '',
  auth0ClientId: '',
  auth0Audience: '',
  apiUrl: '',
};

/**
 * Detects placeholder / empty / .env.example default values. Lets the SPA
 * surface a clear error instead of silently failing the Auth0 init when the
 * stack was started without a real .env file.
 */
export function isAuth0Configured(): boolean {
  const placeholder = (v: string): boolean =>
    !v || v.startsWith('your-') || v === 'changeme' || v === '__missing__';
  return !placeholder(env.auth0Domain) && !placeholder(env.auth0ClientId);
}
