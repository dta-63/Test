import { Injectable, inject } from '@angular/core';
import { AuthService } from '@auth0/auth0-angular';
import { filter, from, switchMap, take } from 'rxjs';

import { CartStore } from './cart.store';
import { env } from './env';
import { NotificationsService } from './notifications.service';

interface ServerEvent {
  type: string;
  site_id?: string;
  product_id?: string;
  reason?: string;
  user_id?: number;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private auth = inject(AuthService);
  private cart = inject(CartStore);
  private notif = inject(NotificationsService);

  private socket: WebSocket | null = null;
  private reconnectDelay = 1000;
  private stopped = false;

  start(): void {
    this.stopped = false;
    this.auth.isAuthenticated$
      .pipe(filter(Boolean), take(1), switchMap(() => from(this.auth.getAccessTokenSilently())))
      .subscribe((token) => this.connect(token));
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private connect(token: string): void {
    if (this.stopped) return;

    const url = new URL(env.apiUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws/cart';
    url.searchParams.set('token', token);

    const socket = new WebSocket(url.toString());
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectDelay = 1000;
    });

    socket.addEventListener('message', (e) => {
      try {
        this.handle(JSON.parse(e.data) as ServerEvent);
      } catch {
        /* ignore malformed */
      }
    });

    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.stopped) return;
      setTimeout(() => this.connect(token), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    });

    socket.addEventListener('error', () => socket.close());
  }

  private handle(event: ServerEvent): void {
    switch (event.type) {
      case 'hello':
        return;
      case 'cart.item_updated':
        this.notif.push(
          `Un article de votre panier a été mis à jour (${this.siteLabel(event.site_id)}).`,
          'info',
        );
        this.cart.refresh();
        return;
      case 'cart.item_removed':
        this.notif.push(
          `Un article a été retiré de votre panier: le produit a été supprimé sur ${this.siteLabel(event.site_id)}.`,
          'warning',
        );
        this.cart.refresh();
        return;
      case 'cart.checked_out':
        this.cart.refresh();
        return;
      case 'order.status_changed':
        this.notif.push(this.statusChangeMessage(event), 'info', 7000);
        return;
    }
  }

  private statusChangeMessage(event: ServerEvent & { woo_order_number?: string; new_status?: string; tracking_number?: string }): string {
    const site = this.siteLabel(event.site_id);
    const num = event.woo_order_number ? `#${event.woo_order_number}` : '';
    const status = event.new_status ?? '?';
    const tracking = event.tracking_number ? ` — suivi: ${event.tracking_number}` : '';
    return `Commande ${num} (${site}) → ${status}${tracking}`;
  }

  private siteLabel(siteId: string | undefined): string {
    if (siteId === 'site-a') return 'Shop A';
    if (siteId === 'site-b') return 'Shop B';
    return 'la boutique';
  }
}
