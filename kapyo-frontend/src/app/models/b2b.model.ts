// API contract — dashboard et commandes B2B (miroir des endpoints
// `/api/b2b/dashboard`, `/orders`, `/orders/{id}`).

export type Period = '7d' | '30d' | '90d' | '12m' | 'all';
export type SiteFilter = 'all' | 'site-a' | 'site-b';

export interface KpiCard {
  label: string;
  value: string;
  sub: string | null;
  delta_pct: number | null;
  delta_label: string | null;
}

export interface DailyPoint {
  date: string;
  orders: number;
  revenue: number;
}

export interface SiteSplit {
  site_id: string;
  orders: number;
  revenue: number;
}

export interface TopProduct {
  product_id: string;
  product_name: string;
  site_id: string | null;
  quantity: number;
  revenue: number;
}

export interface RecentOrder {
  id: number;
  site_id: string;
  external_order_number: string;
  customer_email: string;
  customer_name: string;
  total: number;
  currency: string;
  status: string;
  created_at: string;
  admin_url: string | null;
}

export interface Dashboard {
  period: Period;
  site: SiteFilter;
  kpis: KpiCard[];
  by_site: SiteSplit[];
  by_status: Record<string, number>;
  daily_series: DailyPoint[];
  daily_label: string;
  top_products: TopProduct[];
  recent_orders: RecentOrder[];
  currency: string;
  total_in_period: number;
}

export interface OrderDetailItem {
  product_id: string;
  product_name: string;
  quantity: number;
  price: number;
}

export interface OrderDetail {
  id: number;
  site_id: string;
  external_order_id: number;
  external_order_number: string;
  customer_email: string;
  customer_name: string;
  total: number;
  currency: string;
  status: string;
  created_at: string;
  items: OrderDetailItem[];
  admin_url: string | null;
}

export interface OrdersPage {
  items: RecentOrder[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardFilters {
  period: Period;
  site: SiteFilter;
}

export interface OrdersFilters extends DashboardFilters {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}
