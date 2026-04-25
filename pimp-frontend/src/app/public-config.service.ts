import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

import { env } from './env';

export interface PublicConfig {
  stripe_publishable_key: string;
  stripe_enabled: boolean;
  cart_ttl_seconds: number;
}

@Injectable({ providedIn: 'root' })
export class PublicConfigService {
  private http = inject(HttpClient);

  readonly config = signal<PublicConfig | null>(null);

  load(): void {
    this.http.get<PublicConfig>(`${env.apiUrl}/api/config/public`).subscribe({
      next: (c) => this.config.set(c),
      error: () => this.config.set({ stripe_enabled: false, stripe_publishable_key: '', cart_ttl_seconds: 0 }),
    });
  }
}
