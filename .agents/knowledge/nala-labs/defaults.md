# Nala Labs Platform Defaults

This file documents the development defaults defined by the
`scripts/lib/config.sh` script in the `nala-labs` project.
Environment variables can override them at install time. 
These credentials are suitable only for the local Minikube lab; rotate them before sharing the cluster.

## Public access

| Service | URL | Login |
| --- | --- | --- |
| Casdoor | https://casdoor.nalanirvana.com or https://casdoor.win.nalanirvana.com | `built-in/admin` / `123` on a fresh Casdoor database |
| Harbor | https://harbor.nalanirvana.com or https://harbor.win.nalanirvana.com | `admin` / `nala-labs-harbor-admin` if unchanged |
| Flagr | https://flagr.nalanirvana.com or https://flagr.win.nalanirvana.com | No authentication configured by the installer |
| Vault UI | https://vault.nalanirvana.com or https://vault.win.nalanirvana.com | Token `nala-labs-vault` |
| Kafka UI | https://kafka-ui.nalanirvana.com or https://kafka-ui.win.nalanirvana.com | UI authentication disabled in the lab chart values |
| Kafka broker | `kafka.nalanirvana.com` or `kafka.win.nalanirvana.com` | TCP route; use `cloudflared access tcp`, not a browser |

Casdoor's bootstrap credentials are the standard development credentials
documented by Casdoor. See the [Casdoor deployment documentation](https://casdoor.org/pdf/Casdoor_Docs.pdf).

The Harbor password is only the initial installer value. Harbor stores the
actual admin password in its own database and ignores later Helm password
changes after initialization. If it has been changed, use Harbor's password
reset flow or inspect the current cluster secret:

```bash
kubectl -n nala-labs get secret harbor-core   -o jsonpath='{.data.HARBOR_ADMIN_PASSWORD}' | base64 --decode
```

Protect Casdoor, Harbor, Vault, and Kafka UI with Cloudflare Access before
making the URLs available outside a trusted lab.

## Database and cache credentials

### PostgreSQL

- Service: `postgresql.nala-labs.svc.cluster.local:5432`
- Application user: `nala_labs`
- Application password: `nala-labs-postgres`
- PostgreSQL superuser: `postgres`
- Superuser password: `nala-labs-postgres-admin`
- Databases created for platform services: `app`, `casdoor`, `flagr`, and `harbor`

Local access:

```bash
kubectl -n nala-labs port-forward svc/postgresql 5432:5432
PGPASSWORD='nala-labs-postgres' psql -h 127.0.0.1 -U nala_labs -d app
```

Casdoor, Flagr, and Harbor use separate databases in this shared PostgreSQL
release. A separate `postgresql-app` release is reserved for future application
development.

### Future-app PostgreSQL

- Service: `postgresql-app.nala-labs.svc.cluster.local:5432`
- Database: `app`
- Application user: `nala_labs_app`
- Application password: `nala-labs-app-postgres`
- Superuser password: `nala-labs-app-postgres-admin`

### MongoDB

- Service: `mongodb.nala-labs.svc.cluster.local:27017`
- Root user: `root`
- Root password: `nala-labs-mongodb`

Local access:

```bash
kubectl -n nala-labs port-forward svc/mongodb 27017:27017
mongosh 'mongodb://root:nala-labs-mongodb@127.0.0.1:27017/admin'
```

### Redis

- Service: `redis-master.nala-labs.svc.cluster.local:6379`
- Password: `nala-labs-redis`
- Protocol: Redis RESP over TCP
- Public hostname when the Cloudflare TCP route is provisioned:
  `redis.nalanirvana.com` or `redis.win.nalanirvana.com`

Local access:

```bash
kubectl -n nala-labs port-forward svc/redis-master 6666:6379
redis-cli -h 127.0.0.1 -p 6666 -a 'nala-labs-redis'
```

A generic `6379:6379` forward is also valid when the host port is available.

For external access, the Cloudflare TCP route must exist before creating the
local Access bridge:

```bash
cloudflared access tcp --hostname redis.nalanirvana.com --url localhost:6666
```

The Redis hostname in Vault is only a configuration value; it does not create
the Cloudflare DNS or tunnel route.

### Kafka

The installer creates a single-node Kafka KRaft cluster with SASL/PLAIN:

- Image: `bitnamilegacy/kafka:4.0.0-debian-12-r10`
- Internal bootstrap: `kafka.nala-labs.svc.cluster.local:9092`
- Client username: `nala-labs`
- Client password: `nala-labs-kafka`
- Security protocol: `SASL_PLAINTEXT`
- SASL mechanism: `PLAIN`
- Inter-broker user/password: `inter_broker_user` / `nala-labs-kafka-interbroker`
- Controller user/password: `controller_user` / `nala-labs-kafka-controller`

Kafka's controller and inter-broker passwords are also configurable through
`KAFKA_CONTROLLER_PASSWORD` and `KAFKA_INTERBROKER_PASSWORD`; they are not
normally needed by application clients.

For an external client, first create the local TCP bridge:

```bash
cloudflared access tcp --hostname kafka.nalanirvana.com --url localhost:9092
```

Then connect the Kafka client to `localhost:9092` with the client credentials
above. Kafka UI uses the internal bootstrap address automatically.

## Vault

- Service: `vault.nala-labs.svc.cluster.local:8200`
- Root token: `nala-labs-vault`
- UI: https://vault.nalanirvana.com or https://vault.win.nalanirvana.com
- Local UI/API access:

```bash
kubectl -n nala-labs port-forward svc/vault 8200:8200
export VAULT_ADDR='http://127.0.0.1:8200'
export VAULT_TOKEN='nala-labs-vault'
vault status
```

Vault is installed in standalone mode with a persistent file backend. The
installer stores the configured root token and one unseal key in the
`vault-bootstrap` Kubernetes Secret so a recreated pod can be unsealed.

## Service-specific access notes

- Casdoor service: `casdoor.nala-labs.svc.cluster.local:8000`; public URL is
  HTTPS through the NGINX ingress and Cloudflare Tunnel.
- Flagr service: `flagr.nala-labs.svc.cluster.local:18000`; its health API is
  available at `/api/v1/health`.
- Harbor's registry storage is managed by the Harbor Helm release, while Harbor
  uses the shared PostgreSQL and Redis services. Its public entries are
  `harbor.nalanirvana.com` and `harbor.win.nalanirvana.com`.
- Kafka UI service: `kafka-ui.nala-labs.svc.cluster.local:80`; its lab
  authentication is disabled, so protect the public hostname with Cloudflare
  Access.
- Cloudflare Tunnel has no default user account. The tunnel token, API token,
  account ID, and tunnel ID are supplied externally through environment
  variables or `notes.txt`; they are intentionally not recorded here. The
  installer uses `CLOUDFLARE_ROUTE_SCOPE=auto`: Windows selects both base and
  `.win` routes, while other hosts select base routes. With the Windows notes,
  the base and `.win` published applications therefore belong to
  `nala-windows`.

## Finding the effective configuration

```bash
kubectl -n nala-labs get pods
kubectl -n nala-labs get svc
kubectl -n nala-labs get ingress
helm -n nala-labs list
```

If a credential was overridden during installation or changed in the service
itself, the effective value is not necessarily the default shown above.
