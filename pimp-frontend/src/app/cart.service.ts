import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from './env';

export interface CartItem {
  id: number;
  site_id: string;
  product_id: string;
  product_name: string;
  product_url: string;
  image_url: string | null;
  price: number;
  currency: string;
  quantity: number;
  added_at: string;
}

export interface CartView {
  items: CartItem[];
  total: number;
  currency: string;
}

@Injectable({ providedIn: 'root' })
export class CartService {
  private http = inject(HttpClient);
  private base = `${env.apiUrl}/api`;

  getCart(): Observable<CartView> {
    return this.http.get<CartView>(`${this.base}/cart`);
  }

  deleteItem(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/cart/items/${id}`);
  }

  clearCart(): Observable<void> {
    return this.http.delete<void>(`${this.base}/cart`);
  }
}
