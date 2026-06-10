import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, shareReplay, switchMap } from 'rxjs';

import { CartView } from '@models/cart.model';
import { CartService } from '@services/cart.service';

@Injectable({ providedIn: 'root' })
export class CartStore {
  private api = inject(CartService);
  private refresh$ = new BehaviorSubject<void>(undefined);

  readonly cart$: Observable<CartView> = this.refresh$.pipe(
    switchMap(() => this.api.getCart()),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  refresh(): void {
    this.refresh$.next();
  }

  remove(id: number): void {
    this.api.deleteItem(id).subscribe(() => this.refresh());
  }

  clear(): void {
    this.api.clearCart().subscribe(() => this.refresh());
  }
}
