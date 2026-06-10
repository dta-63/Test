// Modèle UI — toasts éphémères affichés par le shell (alimentés par le WS).

export type NotificationKind = 'info' | 'success' | 'warning';

export interface Notification {
  id: number;
  kind: NotificationKind;
  message: string;
}
