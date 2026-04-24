FROM node:20-alpine AS build
WORKDIR /app

ARG AUTH0_DOMAIN
ARG AUTH0_CLIENT_ID
ARG AUTH0_AUDIENCE
ARG API_URL

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

# Inject runtime config as a static JS file consumed by the app bootstrap
RUN mkdir -p src/assets && printf 'window.__pimp_env__=%s;\n' \
    "$(printf '{"auth0Domain":"%s","auth0ClientId":"%s","auth0Audience":"%s","apiUrl":"%s"}' \
      "$AUTH0_DOMAIN" "$AUTH0_CLIENT_ID" "$AUTH0_AUDIENCE" "$API_URL")" \
    > src/assets/env.js

RUN npx ng build --configuration production

FROM nginx:1.27-alpine
COPY --from=build /app/dist/pimp-frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
