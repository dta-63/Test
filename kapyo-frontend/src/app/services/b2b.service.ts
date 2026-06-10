import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from '@core/env';

import {
  Dashboard,
  DashboardFilters,
  OrderDetail,
  OrdersFilters,
  OrdersPage,
} from '@models/b2b.model';

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
