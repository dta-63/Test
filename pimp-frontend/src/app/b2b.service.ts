import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from './env';

export interface KpiCard {
  label: string;
  value: string;
  sub: string | null;
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
  kpis: KpiCard[];
  by_site: SiteSplit[];
  by_status: Record<string, number>;
  daily_30d: DailyPoint[];
  top_products: TopProduct[];
  recent_orders: RecentOrder[];
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class B2bService {
  private http = inject(HttpClient);

  getDashboard(): Observable<Dashboard> {
    return this.http.get<Dashboard>(`${env.apiUrl}/api/b2b/dashboard`);
  }
}
