import { AsyncPipe, CurrencyPipe, DatePipe, KeyValuePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { B2bService, Dashboard } from './b2b.service';

@Component({
  selector: 'app-b2b-dashboard',
  standalone: true,
  imports: [NgIf, NgFor, NgClass, AsyncPipe, CurrencyPipe, DatePipe, KeyValuePipe],
  template: `
    <ng-container *ngIf="data() as d; else loading">
      <h1>Tableau de bord B2B</h1>

      <section class="kpis">
        <div class="kpi" *ngFor="let k of d.kpis">
          <span class="label">{{ k.label }}</span>
          <span class="value">{{ k.value }}</span>
          <span class="sub" *ngIf="k.sub">{{ k.sub }}</span>
        </div>
      </section>

      <section class="grid">
        <article class="card chart-card">
          <header>
            <h2>Commandes — 30 derniers jours</h2>
            <span class="muted">{{ totalRecent() }} commandes / {{ totalRevenue() | currency: d.currency }}</span>
          </header>
          <svg class="sparkline" [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH" preserveAspectRatio="none">
            <path *ngIf="areaPath()" [attr.d]="areaPath()" fill="rgba(124,58,237,0.15)"></path>
            <path *ngIf="linePath()" [attr.d]="linePath()" fill="none" stroke="#7c3aed" stroke-width="2"></path>
            <line *ngFor="let g of gridLines()" [attr.x1]="0" [attr.x2]="chartW" [attr.y1]="g" [attr.y2]="g" stroke="#e5e7eb" stroke-dasharray="2 4"></line>
          </svg>
          <footer class="axis">
            <span>{{ d.daily_30d[0].date | date: 'shortDate' }}</span>
            <span>{{ d.daily_30d[d.daily_30d.length - 1].date | date: 'shortDate' }}</span>
          </footer>
        </article>

        <article class="card">
          <header><h2>Répartition par boutique</h2></header>
          <ul class="bars">
            <li *ngFor="let s of d.by_site">
              <div class="bar-row">
                <span class="chip" [attr.data-site]="s.site_id">
                  {{ s.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}
                </span>
                <span class="bar-value">{{ s.orders }} cmd · {{ s.revenue | currency: d.currency }}</span>
              </div>
              <div class="bar-track"><div class="bar-fill" [attr.data-site]="s.site_id" [style.width.%]="pctOfMax(s.orders, d.by_site)"></div></div>
            </li>
          </ul>
        </article>

        <article class="card">
          <header><h2>Statuts</h2></header>
          <ul class="status-list">
            <li *ngFor="let s of d.by_status | keyvalue">
              <span class="status-pill" [attr.data-status]="s.key">{{ s.key }}</span>
              <strong>{{ s.value }}</strong>
            </li>
            <li *ngIf="(d.by_status | keyvalue).length === 0" class="muted">Aucune commande pour l'instant.</li>
          </ul>
        </article>

        <article class="card">
          <header><h2>Top produits</h2></header>
          <ol class="top-products">
            <li *ngFor="let p of d.top_products; let i = index">
              <span class="rank">{{ i + 1 }}</span>
              <div class="product-info">
                <span class="product-name">{{ p.product_name }}</span>
                <span class="muted">
                  <span class="chip" [attr.data-site]="p.site_id">
                    {{ p.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}
                  </span>
                  · {{ p.quantity }} unités · {{ p.revenue | currency: d.currency }}
                </span>
              </div>
            </li>
            <li *ngIf="d.top_products.length === 0" class="muted">Pas encore de ventes.</li>
          </ol>
        </article>
      </section>

      <section class="card recent">
        <header><h2>Dernières commandes</h2></header>
        <table *ngIf="d.recent_orders.length > 0; else noOrders">
          <thead>
            <tr>
              <th>Date</th>
              <th>Boutique</th>
              <th>N°</th>
              <th>Client</th>
              <th>Montant</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let o of d.recent_orders">
              <td>{{ o.created_at | date: 'short' }}</td>
              <td><span class="chip" [attr.data-site]="o.site_id">{{ o.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}</span></td>
              <td>#{{ o.woo_order_number }}</td>
              <td>
                <div>{{ o.customer_name }}</div>
                <div class="muted">{{ o.customer_email }}</div>
              </td>
              <td>{{ o.total | currency: o.currency }}</td>
              <td><span class="status-pill" [attr.data-status]="o.status">{{ o.status }}</span></td>
              <td><a *ngIf="o.admin_url" [href]="o.admin_url" target="_blank" rel="noopener">Voir</a></td>
            </tr>
          </tbody>
        </table>
        <ng-template #noOrders>
          <p class="muted">Aucune commande à afficher pour le moment.</p>
        </ng-template>
      </section>
    </ng-container>
    <ng-template #loading><p>Chargement du tableau de bord…</p></ng-template>
  `,
  styles: [`
    h1 { margin: 0 0 20px; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .kpi {
      background: white; padding: 16px; border-radius: 12px;
      border: 1px solid var(--pimp-border);
      display: flex; flex-direction: column; gap: 4px;
    }
    .kpi .label { font-size: 12px; color: var(--pimp-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi .value { font-size: 26px; font-weight: 700; color: var(--pimp-primary); }
    .kpi .sub { font-size: 12px; color: var(--pimp-muted); }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 16px; }
    .card { background: white; padding: 16px; border-radius: 12px; border: 1px solid var(--pimp-border); }
    .card header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
    .card h2 { margin: 0; font-size: 14px; text-transform: uppercase; color: var(--pimp-muted); letter-spacing: 0.05em; }
    .muted { color: var(--pimp-muted); font-size: 12px; }
    .chart-card .sparkline { width: 100%; height: 140px; display: block; }
    .chart-card .axis { display: flex; justify-content: space-between; font-size: 11px; color: var(--pimp-muted); margin-top: 6px; }
    .bars { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
    .bar-row { display: flex; justify-content: space-between; gap: 10px; align-items: center; font-size: 13px; }
    .bar-track { background: var(--pimp-bg); border-radius: 4px; height: 8px; overflow: hidden; margin-top: 4px; }
    .bar-fill { height: 100%; }
    .bar-fill[data-site="site-a"] { background: var(--pimp-shop-a); }
    .bar-fill[data-site="site-b"] { background: var(--pimp-shop-b); }
    .chip { padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; color: white; }
    .chip[data-site="site-a"] { background: var(--pimp-shop-a); }
    .chip[data-site="site-b"] { background: var(--pimp-shop-b); }
    .status-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .status-list li { display: flex; justify-content: space-between; }
    .status-pill {
      padding: 2px 10px; border-radius: 999px; font-size: 11px;
      background: #f3f4f6; color: var(--pimp-text);
    }
    .status-pill[data-status="completed"]  { background: #d1fae5; color: #065f46; }
    .status-pill[data-status="processing"] { background: #dbeafe; color: #1e40af; }
    .status-pill[data-status="pending"]    { background: #fef3c7; color: #92400e; }
    .status-pill[data-status="cancelled"], .status-pill[data-status="failed"] { background: #fee2e2; color: #991b1b; }
    .top-products { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .top-products li { display: flex; gap: 12px; align-items: center; }
    .rank {
      width: 24px; height: 24px; border-radius: 50%; background: var(--pimp-bg);
      color: var(--pimp-primary); font-weight: 700; font-size: 12px;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .product-info { display: flex; flex-direction: column; gap: 2px; }
    .product-name { font-weight: 600; font-size: 14px; }
    .recent table { width: 100%; border-collapse: collapse; }
    .recent th, .recent td { padding: 10px 8px; border-bottom: 1px solid var(--pimp-border); text-align: left; font-size: 13px; vertical-align: top; }
    .recent th { color: var(--pimp-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .recent td a { color: var(--pimp-primary); }
  `],
})
export class B2bDashboardComponent {
  private api = inject(B2bService);
  readonly chartW = 600;
  readonly chartH = 140;

  data = toSignal(this.api.getDashboard(), { initialValue: null as Dashboard | null });

  totalRecent = computed(() => {
    const d = this.data();
    return d ? d.daily_30d.reduce((s, p) => s + p.orders, 0) : 0;
  });
  totalRevenue = computed(() => {
    const d = this.data();
    return d ? d.daily_30d.reduce((s, p) => s + p.revenue, 0) : 0;
  });

  linePath = computed(() => this.buildPath(false));
  areaPath = computed(() => this.buildPath(true));

  gridLines = computed(() => [this.chartH * 0.25, this.chartH * 0.5, this.chartH * 0.75]);

  private buildPath(asArea: boolean): string {
    const d = this.data();
    if (!d || d.daily_30d.length === 0) return '';
    const pts = d.daily_30d.map((p) => p.orders);
    const max = Math.max(1, ...pts);
    const stepX = this.chartW / Math.max(1, pts.length - 1);
    const padding = 8;
    const usableH = this.chartH - padding * 2;
    const coords = pts.map((v, i) => {
      const x = i * stepX;
      const y = padding + usableH - (v / max) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    if (asArea) {
      const first = `0,${this.chartH}`;
      const last = `${this.chartW},${this.chartH}`;
      return `M ${first} L ${coords.join(' L ')} L ${last} Z`;
    }
    return `M ${coords.join(' L ')}`;
  }

  pctOfMax(value: number, list: { orders: number }[]): number {
    const max = Math.max(1, ...list.map((s) => s.orders));
    return Math.round((value / max) * 100);
  }
}
