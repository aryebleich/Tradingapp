# Kubernetes

    kubectl apply -f namespace.yaml
    cp secret.example.yaml secret.yaml   # fill in, do not commit
    kubectl apply -f secret.yaml -f deployment.yaml -f hpa.yaml -f predictive-scaler.yaml

- Build and push the image from the repository's Dockerfile, then set it in `deployment.yaml`.
- Use a shared database (`DATABASE_URL`, libSQL/Turso). A local SQLite file does not work across replicas.
- `/readyz` takes a replica out of the load balancer above 95% load; `/healthz` restarts a stuck one.
- `/metrics` (Prometheus) exposes `qp_load_ratio`, `qp_order_queue_pending`, shed counts and breaker
  states. The HPA's custom metrics need a Prometheus adapter; without one, delete those two entries.
- Load shedding starts at `SHED_AT` (0.85): analytics, charts data, backtests and AI pause; orders,
  risk controls, the account lock and sign-in keep working.
- Stress test a staging deployment with `node scripts/loadtest.mjs` (see the script header), or run
  the "Chaos drill" workflow in GitHub Actions.
