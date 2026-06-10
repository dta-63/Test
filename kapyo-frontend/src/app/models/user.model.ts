// API contract — compte utilisateur (miroir des schemas backend `UserOut`,
// `AccountStats`, `AccountView`, `MeOut`).

export interface KapyoUser {
  id: number;
  auth0_sub: string;
  email: string | null;
  created_at: string;
}

export interface AccountStats {
  total_items: number;
  total_quantity: number;
  total_value: number;
  currency: string;
  by_site: Record<string, number>;
}

export interface AccountView {
  user: KapyoUser;
  stats: AccountStats;
}

export interface MeView {
  user: KapyoUser;
  is_b2b: boolean;
}
