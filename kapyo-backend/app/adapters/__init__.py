"""Adapters — concrete implementations of the ports.

Outbound adapters (woocommerce, shopify) translate the domain types into a
specific platform's API and back. They are the *only* place platform-specific
JSON, auth schemes, and endpoints live.
"""
