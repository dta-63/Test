import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from './env';

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
  woo_order_number: string;
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
  woo_order_id: number;
  woo_order_number: string;
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

@Injectable({ providedIn: 'root' })
export class B2bService {
  private http = inject(HttpClient);
  private base = `${env.apiUrl}/api/b2b`;

  getDashboard(filters: DashboardFilters): Observable<Dashboard> {
    const params = new HttpParams().set('period', filters.period).set('site', filters.site);
    return this.http.get<Dashboard>(`${this.base}/dashboard`, { params });
  }

  listOrders(filters: OrdersFilters): Observable<OrdersPage> {
    let params = new HttpParams().set('period', filters.period).set('site', filters.site);
    if (filters.q) params = params.set('q', filters.q);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.limit !== undefined) params = params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params = params.set('offset', String(filters.offset));
    return this.http.get<OrdersPage>(`${this.base}/orders`, { params });
  }

  getOrder(id: number): Observable<OrderDetail> {
    return this.http.get<OrderDetail>(`${this.base}/orders/${id}`);
  }

  downloadCsv(filters: OrdersFilters): Observable<Blob> {
    let params = new HttpParams().set('period', filters.period).set('site', filters.site);
    if (filters.q) params = params.set('q', filters.q);
    if (filters.status) params = params.set('status', filters.status);
    return this.http.get(`${this.base}/orders.csv`, { params, responseType: 'blob' });
  }
}
