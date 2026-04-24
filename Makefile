.PHONY: up down logs ps restart build clean hosts help

help:
	@echo "Pimp stack - commandes disponibles:"
	@echo "  make up       - Lance toute la stack (la commande unique demandée)"
	@echo "  make down     - Arrête la stack"
	@echo "  make clean    - Arrête + supprime les volumes (RAZ totale)"
	@echo "  make logs     - Suit les logs de tous les services"
	@echo "  make ps       - Liste les containers"
	@echo "  make build    - Rebuild les images custom"
	@echo "  make hosts    - Affiche les lignes à ajouter dans /etc/hosts"

up:
	@test -f .env || cp .env.example .env
	docker compose up -d --build
	@echo ""
	@echo "Stack démarrée. Ajoutez les hosts ci-dessous à /etc/hosts si ce n'est pas déjà fait:"
	@$(MAKE) -s hosts
	@echo ""
	@echo "  - Pimp SaaS:  http://pimp.localhost"
	@echo "  - Pimp API:   http://api.pimp.localhost/docs"
	@echo "  - Shop A:     http://shop-a.localhost"
	@echo "  - Shop B:     http://shop-b.localhost"
	@echo "  - Traefik:    http://localhost:8080"

down:
	docker compose down

clean:
	docker compose down -v

logs:
	docker compose logs -f

ps:
	docker compose ps

build:
	docker compose build

hosts:
	@echo "127.0.0.1 pimp.localhost api.pimp.localhost shop-a.localhost shop-b.localhost"
