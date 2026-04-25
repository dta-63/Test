import { CurrencyPipe, DatePipe, KeyValuePipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { B2bOrderDetailComponent } from './b2b-order-detail.component';
import {
  B2bService, Dashboard, DashboardFilters, OrdersFilters, OrdersPage, Period, RecentOrder, SiteFilter,
} from './b2b.service';
import { NotificationsService } from './notifications.service';

@Component({
  selector: 'app-b2b-dashboard',
  standalone: true,
  imports: [
    NgIf, NgFor, NgClass, CurrencyPipe, DatePipe, KeyValuePipe, FormsModule,
    B2bOrderDetailComponent,
  ],
  template: `
    <header class="page-head">
      <h1>Tableau de bord B2B</h1>

      <div class="filters">
        <div class="seg">
          <button *ngFor="let p of periods" [class.active]="period() === p.k" (click)="setPeriod(p.k)">
            {{ p.label }}
          </button>
        </div>

        <div class="seg">
          <button *ngFor="let s of sites" [class.active]="site() === s.k" (click)="setSite(s.k)">
            {{ s.label }}
          </button>
        </div>
      </div>
    </header>

    <ng-container *ngIf="data() as d; else loading">
      <section class="kpis">
        <div class="kpi" *ngFor="let k of d.kpis">
          <span class="label">{{ k.label }}</span>
          <span class="value">{{ k.value }}</span>
          <span *ngIf="k.delta_pct !== null" class="delta" [attr.data-trend]="k.delta_pct! >= 0 ? 'up' : 'down'">
            {{ k.delta_pct! >= 0 ? '▲' : '▼' }} {{ k.delta_pct! >= 0 ? '+' : '' }}{{ k.delta_pct }}%
            <span class="muted">{{ k.delta_label }}</span>
          </span>
          <span *ngIf="k.sub && k.delta_pct === null" class="sub">{{ k.sub }}</span>
        </div>
      </section>

      <section class="grid">
        <article class="card chart-card">
          <header><h2>{{ d.daily_label }}</h2><span class="muted">{{ d.total_in_period }} commandes</span></header>
          <svg class="sparkline" [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH" preserveAspectRatio="none">
            <path *ngIf="areaPath()" [attr.d]="areaPath()" fill="rgba(124,58,237,0.15)"></path>
            <path *ngIf="linePath()" [attr.d]="linePath()" fill="none" stroke="#7c3aed" stroke-width="2"></path>
            <line *ngFor="let g of gridLines()" [attr.x1]="0" [attr.x2]="chartW" [attr.y1]="g" [attr.y2]="g" stroke="#e5e7eb" stroke-dasharray="2 4"></line>
          </svg>
          <footer class="axis" *ngIf="d.daily_series.length">
            <span>{{ d.daily_series[0].date | date: 'shortDate' }}</span>
            <span>{{ d.daily_series[d.daily_series.length - 1].date | date: 'shortDate' }}</span>
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
            <li *ngIf="d.by_site.length === 0" class="muted">Aucune donnée sur cette période.</li>
          </ul>
        </article>

        <article class="card">
          <header><h2>Statuts</h2></header>
          <ul class="status-list">
            <li *ngFor="let s of d.by_status | keyvalue">
              <span class="status-pill" [attr.data-status]="s.key">{{ s.key }}</span>
              <strong>{{ s.value }}</strong>
            </li>
            <li *ngIf="(d.by_status | keyvalue).length === 0" class="muted">Aucune commande.</li>
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
        <header class="recent-head">
          <h2>Commandes</h2>
          <div class="recent-tools">
            <input
              type="search"
              placeholder="Rechercher (n°, email, nom)…"
              [ngModel]="search()"
              (ngModelChange)="onSearchInput($event)">
            <button class="btn-ghost" (click)="exportCsv()">Exporter CSV</button>
          </div>
        </header>

        <table *ngIf="orders() as page">
          <thead>
            <tr>
              <th>Date</th><th>Boutique</th><th>N°</th><th>Client</th>
              <th>Montant</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr *ngFor="let o of page.items" (click)="openOrder(o)" class="row-clickable">
              <td>{{ o.created_at | date: 'short' }}</td>
              <td><span class="chip" [attr.data-site]="o.site_id">{{ o.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}</span></td>
              <td>#{{ o.woo_order_number }}</td>
              <td>
                <div>{{ o.customer_name }}</div>
                <div class="muted">{{ o.customer_email }}</div>
              </td>
              <td>{{ o.total | currency: o.currency }}</td>
              <td><span class="status-pill" [attr.data-status]="o.status">{{ o.status }}</span></td>
              <td><a *ngIf="o.admin_url" [href]="o.admin_url" target="_blank" rel="noopener" (click)="$event.stopPropagation()">Admin</a></td>
            </tr>
            <tr *ngIf="page.items.length === 0">
              <td colspan="7" class="muted center">Aucune commande pour ces filtres.</td>
            </tr>
          </tbody>
        </table>

        <footer class="pager" *ngIf="orders() as page">
          <span class="muted">{{ page.total }} commande(s) au total</span>
          <div class="pager-ctrls" *ngIf="page.total > pageSize">
            <button class="btn-ghost" [disabled]="offset() === 0" (click)="prevPage()">‹ Précédent</button>
            <span>{{ offset() + 1 }} – {{ Math.min(offset() + pageSize, page.total) }}</span>
            <button class="btn-ghost" [disabled]="offset() + pageSize >= page.total" (click)="nextPage()">Suivant ›</button>
          </div>
        </footer>
      </section>
    </ng-container>
    <ng-template #loading><p>Chargement du tableau de bord…</p></ng-template>

    <app-b2b-order-detail
      *ngIf="selectedOrderId() !== null"
      [orderId]="selectedOrderId()!"
      (close)="selectedOrderId.set(null)">
    </app-b2b-order-detail>
  `,
  styles: [`
    .page-head { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
    h1 { margin: 0; }
    .filters { display: flex; gap: 8px; flex-wrap: wrap; }
    .seg { display: inline-flex; background: white; border: 1px solid var(--pimp-border); border-radius: 8px; overflow: hidden; }
    .seg button { background: transparent; padding: 6px 12px; font-size: 13px; color: var(--pimp-text); border-radius: 0; border-right: 1px solid var(--pimp-border); }
    .seg button:last-child { border-right: none; }
    .seg button.active { background: var(--pimp-primary); color: white; }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .kpi { background: white; padding: 16px; border-radius: 12px; border: 1px solid var(--pimp-border); display: flex; flex-direction: column; gap: 4px; }
    .kpi .label { font-size: 12px; color: var(--pimp-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi .value { font-size: 26px; font-weight: 700; color: var(--pimp-primary); }
    .kpi .sub { font-size: 12px; color: var(--pimp-muted); }
    .delta { font-size: 12px; display: inline-flex; gap: 6px; align-items: center; }
    .delta[data-trend="up"]   { color: #047857; }
    .delta[data-trend="down"] { color: #b91c1c; }
    .delta .muted { color: var(--pimp-muted); font-weight: 400; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 16px; }
    .card { background: white; padding: 16px; border-radius: 12px; border: 1px solid var(--pimp-border); }
    .card header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
    .card h2 { margin: 0; font-size: 14px; text-transform: uppercase; color: var(--pimp-muted); letter-spacing: 0.05em; }
    .muted { color: var(--pimp-muted); font-size: 12px; }
    .center { text-align: center; padding: 20px !important; }
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
    .status-pill { padding: 2px 10px; border-radius: 999px; font-size: 11px; background: #f3f4f6; color: var(--pimp-text); }
    .status-pill[data-status="completed"]  { background: #d1fae5; color: #065f46; }
    .status-pill[data-status="processing"] { background: #dbeafe; color: #1e40af; }
    .status-pill[data-status="pending"]    { background: #fef3c7; color: #92400e; }
    .status-pill[data-status="cancelled"], .status-pill[data-status="failed"] { background: #fee2e2; color: #991b1b; }
    .top-products { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    .top-products li { display: flex; gap: 12px; align-items: center; }
    .rank { width: 24px; height: 24px; border-radius: 50%; background: var(--pimp-bg); color: var(--pimp-primary); font-weight: 700; font-size: 12px; display: inline-flex; align-items: center; justify-content: center; }
    .product-info { display: flex; flex-direction: column; gap: 2px; }
    .product-name { font-weight: 600; font-size: 14px; }
    .recent-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .recent-tools { display: flex; gap: 8px; align-items: center; }
    .recent-tools input {
      padding: 8px 10px; border: 1px solid var(--pimp-border); border-radius: 6px;
      font-size: 13px; min-width: 240px;
    }
    .recent table { width: 100%; border-collapse: collapse; }
    .recent th, .recent td { padding: 10px 8px; border-bottom: 1px solid var(--pimp-border); text-align: left; font-size: 13px; vertical-align: top; }
    .recent th { color: var(--pimp-muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .recent td a { color: var(--pimp-primary); }
    .row-clickable { cursor: pointer; }
    .row-clickable:hover { background: var(--pimp-bg); }
    .pager { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--pimp-border); }
    .pager-ctrls { display: flex; gap: 8px; align-items: center; font-size: 13px; }
  `],
})
export class B2bDashboardComponent {
  private api = inject(B2bService);
  private notif = inject(NotificationsService);

  readonly chartW = 600;
  readonly chartH = 140;
  readonly pageSize = 50;
  readonly Math = Math;

  readonly periods: { k: Period; label: string }[] = [
    { k: '7d', label: '7j' },
    { k: '30d', label: '30j' },
    { k: '90d', label: '90j' },
    { k: '12m', label: '12m' },
    { k: 'all', label: 'Tout' },
  ];
  readonly sites: { k: SiteFilter; label: string }[] = [
    { k: 'all', label: 'Toutes' },
    { k: 'site-a', label: 'Shop A' },
    { k: 'site-b', label: 'Shop B' },
  ];

  // State
  period = signal<Period>('30d');
  site = signal<SiteFilter>('all');
  search = signal<string>('');
  offset = signal<number>(0);
  selectedOrderId = signal<number | null>(null);

  private dashboardTrigger$ = new Subject<DashboardFilters>();
  private ordersTrigger$ = new Subject<OrdersFilters>();
  private searchInput$ = new Subject<string>();

  data = toSignal(this.dashboardTrigger$.pipe(switchMap((f) => this.api.getDashboard(f))), { initialValue: null as Dashboard | null });
  orders = toSignal(this.ordersTrigger$.pipe(switchMap((f) => this.api.listOrders(f))), { initialValue: null as OrdersPage | null });

  constructor() {
    this.searchInput$.pipe(debounceTime(250), distinctUntilChanged()).subscribe((v) => {
      this.search.set(v);
      this.offset.set(0);
      this.refresh({ ordersOnly: true });
    });
    queueMicrotask(() => this.refresh());
  }

  // -- chart computeds
  linePath = computed(() => this.buildPath(false));
  areaPath = computed(() => this.buildPath(true));
  gridLines = computed(() => [this.chartH * 0.25, this.chartH * 0.5, this.chartH * 0.75]);

  private buildPath(asArea: boolean): string {
    const d = this.data();
    if (!d || d.daily_series.length === 0) return '';
    const pts = d.daily_series.map((p) => p.orders);
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
      return `M 0,${this.chartH} L ${coords.join(' L ')} L ${this.chartW},${this.chartH} Z`;
    }
    return `M ${coords.join(' L ')}`;
  }

  pctOfMax(value: number, list: { orders: number }[]): number {
    const max = Math.max(1, ...list.map((s) => s.orders));
    return Math.round((value / max) * 100);
  }

  // -- filter actions
  setPeriod(p: Period): void {
    this.period.set(p);
    this.offset.set(0);
    this.refresh();
  }

  setSite(s: SiteFilter): void {
    this.site.set(s);
    this.offset.set(0);
    this.refresh();
  }

  onSearchInput(v: string): void {
    this.searchInput$.next(v);
  }

  // -- pagination
  prevPage(): void {
    this.offset.update((o) => Math.max(0, o - this.pageSize));
    this.refresh({ ordersOnly: true });
  }

  nextPage(): void {
    this.offset.update((o) => o + this.pageSize);
    this.refresh({ ordersOnly: true });
  }

  // -- refresh
  private refresh(opts: { ordersOnly?: boolean } = {}): void {
    const filters: OrdersFilters = {
      period: this.period(),
      site: this.site(),
      q: this.search() || undefined,
      limit: this.pageSize,
      offset: this.offset(),
    };
    this.ordersTrigger$.next(filters);
    if (!opts.ordersOnly) {
      this.dashboardTrigger$.next({ period: filters.period, site: filters.site });
    }
  }

  // -- detail modal
  openOrder(o: RecentOrder): void {
    this.selectedOrderId.set(o.id);
  }

  // -- CSV export
  exportCsv(): void {
    const filters: OrdersFilters = {
      period: this.period(),
      site: this.site(),
      q: this.search() || undefined,
    };
    this.api.downloadCsv(filters).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pimp-orders-${this.period()}-${this.site()}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      },
      error: (e) => this.notif.push(`Export impossible: ${e?.error?.detail ?? e.message}`, 'warning'),
    });
  }
}
