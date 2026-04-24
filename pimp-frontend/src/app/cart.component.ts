import { AsyncPipe, CurrencyPipe, DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';

import { CartStore } from './cart.store';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [NgIf, NgFor, AsyncPipe, CurrencyPipe, DatePipe],
  template: `
    <ng-container *ngIf="auth.isAuthenticated$ | async; else notLogged">
      <section *ngIf="cart$ | async as cart; else loading">
        <div class="header-row">
          <h1>Mon panier</h1>
          <button class="btn-ghost" (click)="clear()" [disabled]="cart.items.length === 0">
            Vider
          </button>
        </div>

        <div *ngIf="cart.items.length === 0" class="empty">
          Aucun article pour le moment. Rendez-vous sur
          <a href="http://shop-a.localhost">Shop A</a> ou
          <a href="http://shop-b.localhost">Shop B</a>
          et cliquez sur le bouton violet.
        </div>

        <div class="grid">
          <article *ngFor="let item of cart.items" class="card" [attr.data-site]="item.site_id">
            <div class="thumb">
              <img *ngIf="item.image_url" [src]="item.image_url" [alt]="item.product_name">
            </div>
            <div class="body">
              <span class="chip">{{ item.site_id === 'site-a' ? 'Shop A' : 'Shop B' }}</span>
              <h3><a [href]="item.product_url" target="_blank" rel="noopener">{{ item.product_name }}</a></h3>
              <div class="meta">
                <span>{{ item.price | currency: item.currency }}</span>
                <span>×{{ item.quantity }}</span>
                <span class="date">ajouté le {{ item.added_at | date:'short' }}</span>
              </div>
              <button class="btn-ghost" (click)="remove(item.id)">Retirer</button>
            </div>
          </article>
        </div>

        <footer class="total" *ngIf="cart.items.length > 0">
          <span>Total</span>
          <strong>{{ cart.total | currency: cart.currency }}</strong>
        </footer>
      </section>
      <ng-template #loading><p>Chargement du panier…</p></ng-template>
    </ng-container>

    <ng-template #notLogged>
      <div class="welcome">
        <h1>Bienvenue sur Pimp</h1>
        <p>Connectez-vous pour consulter votre panier unifié depuis Shop A et Shop B.</p>
      </div>
    </ng-template>
  `,
  styles: [`
    .header-row { display: flex; justify-content: space-between; align-items: center; }
    h1 { margin: 0 0 16px; }
    .empty { background: white; padding: 32px; border-radius: 12px; text-align: center; color: var(--pimp-muted); }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-top: 16px; }
    .card {
      background: white; border-radius: 12px; overflow: hidden;
      border: 1px solid var(--pimp-border);
      display: flex; flex-direction: column;
    }
    .card[data-site="site-a"] { border-top: 4px solid var(--pimp-shop-a); }
    .card[data-site="site-b"] { border-top: 4px solid var(--pimp-shop-b); }
    .thumb { background: #f3f4f6; aspect-ratio: 16/10; display:flex; align-items:center; justify-content:center; }
    .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
    .body { padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .chip { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--pimp-muted); }
    h3 { margin: 0; font-size: 16px; }
    h3 a { color: inherit; text-decoration: none; }
    h3 a:hover { color: var(--pimp-primary); }
    .meta { display: flex; gap: 10px; align-items: baseline; font-size: 13px; color: var(--pimp-muted); flex-wrap: wrap; }
    .date { margin-left: auto; }
    .total {
      margin-top: 24px; background: white; padding: 20px; border-radius: 12px;
      display: flex; justify-content: space-between; align-items: center; font-size: 18px;
    }
    .welcome { background: white; padding: 48px; border-radius: 12px; text-align: center; }
  `],
})
export class CartComponent {
  auth = inject(AuthService);
  private store = inject(CartStore);

  cart$ = this.store.cart$;

  remove(id: number): void {
    this.store.remove(id);
  }

  clear(): void {
    this.store.clear();
  }
}
