import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { env } from '@core/env';
import { CartView } from '@models/cart.model';

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
