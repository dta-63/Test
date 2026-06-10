// API contract — panier (miroir des schemas backend `CartItemOut`, `CartView`).

export interface CartItem {
  id: number;
  site_id: string;
  product_id: string;
  variation_id: string | null;
  variation_label: string | null;
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
