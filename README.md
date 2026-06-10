# Simplifica — Gestão de Clientes e Reuniões

Dashboard para acompanhamento de clientes e reuniões da Simplifica (Aceleradora de Negócios).

## Funcionalidades

- Cadastro de clientes com geração automática de 8 reuniões semanais (Onboarding → Reunião de Finalização)
- **Eventos personalizados**: defina manualmente os nomes das reuniões
- **Eventos recorrentes**: repita o mesmo evento por 6 meses (semanal, quinzenal ou mensal)
- Timeline visual com mini-calendários, progresso por cliente e status "Em andamento" / "Projeto Finalizado"
- Gerenciamento de responsáveis (closers) com cores próprias
- **Dados compartilhados**: todos os usuários veem os mesmos clientes (sincronização automática a cada 15s); filtros são individuais por navegador
- Busca, filtros por status e por responsável

## Stack

- Frontend: HTML, CSS e JavaScript puros (sem frameworks)
- Backend: Node.js puro (`server.js`, sem dependências) — serve o site e a API `/api/*`
- Persistência: arquivo JSON em `/data/db.json`

## Rodando localmente

```bash
node server.js
# abre em http://localhost:8080
```

## Deploy (EasyPanel / Docker)

O `Dockerfile` roda o servidor Node na porta **80**.

> ⚠️ **Importante:** adicione um *Volume Mount* em `/data` no EasyPanel — sem ele, os dados são apagados a cada re-deploy.
