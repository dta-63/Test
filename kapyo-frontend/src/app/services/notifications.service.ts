import { Injectable, signal } from '@angular/core';

import { Notification, NotificationKind } from '@models/notification.model';

@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private seq = 0;
  readonly notifications = signal<Notification[]>([]);

  push(message: string, kind: NotificationKind = 'info', ttlMs = 5000): void {
    const id = ++this.seq;
    this.notifications.update((list) => [...list, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), ttlMs);
  }

  dismiss(id: number): void {
    this.notifications.update((list) => list.filter((n) => n.id !== id));
  }
}
