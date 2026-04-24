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
