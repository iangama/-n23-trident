N23.3 — TRIDENT

Trident é um sistema para registrar afirmações (claims) e associar evidências
de forma estruturada, verificável e auditável.

A proposta não é discussão livre, nem consenso social.
É organizar afirmações e exigir que elas sejam sustentadas por evidências
explícitas (fonte, trecho, arquivo), com processamento assíncrono e rastreável.

O projeto foca em arquitetura e operação de sistemas distribuídos:
API, worker, fila, banco, proxy reverso e observabilidade real.

Arquitetura:
- API Node.js com Prisma e PostgreSQL
- Worker assíncrono com BullMQ e Redis
- Front-end Vite
- Proxy Traefik (porta SAFE 8880)
- Observabilidade com Prometheus e Grafana

Funcionalidades principais:
- Autenticação via JWT
- Workspaces (multi-tenant)
- Claims associadas a um workspace
- Evidences ligadas a claims
- Upload de arquivos (PDF) como evidência
- Fila de processamento para verificação
- Estados de evidência (pending, running, verified, rejected)
- Métricas expostas para API e worker

Observabilidade:
- Endpoint /metrics exposto pela API
- Worker expõe métricas próprias
- Prometheus coleta métricas
- Grafana permite visualização e inspeção do sistema

Execução local:
docker compose up -d --build

URLs:
App: http://n23t.localhost:8880
Metrics: http://n23t.localhost:8880/metrics
Prometheus: http://n23t.localhost:8880/prom
Grafana: http://n23t.localhost:8880/graf

Credenciais de demo:
email: demo@n23t.com
senha: demo1234

Motivação técnica:
Este projeto não é sobre UI sofisticada ou tipagem excessiva.
É sobre provar domínio de sistemas reais:
orquestração de serviços, filas, persistência, métricas e debug em ambiente
semelhante a produção.

Nível:
N23 — sistema distribuído com múltiplos serviços, estado persistente,
processamento assíncrono e observabilidade.
