// API contract — config publique exposée par `GET /api/config/public`.
// Aucune valeur secrète : uniquement ce dont le SPA a besoin au runtime.

export interface PublicConfig {
  stripe_publishable_key: string;
  stripe_enabled: boolean;
  cart_ttl_seconds: number;
}
