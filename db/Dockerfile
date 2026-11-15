# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Banco de dados do Treino do Dia (MySQL 8.4 LTS).
#
# O schema é aplicado pelo entrypoint oficial do MySQL apenas quando
# /var/lib/mysql está vazio (primeiro boot do volume). Em boots seguintes os
# dados existentes são preservados e os scripts de init NÃO rodam de novo.
#
# Variáveis obrigatórias em runtime (definidas no docker-compose.yml):
#   MYSQL_ROOT_PASSWORD  senha do root
#   MYSQL_DATABASE       banco criado no primeiro boot (padrão: treino)
#   MYSQL_USER / MYSQL_PASSWORD  usuário da aplicação (criado no primeiro boot)
# ---------------------------------------------------------------------------
FROM mysql:8.4

# Nome padrão do banco; o compose pode sobrescrever via MYSQL_DATABASE.
ENV MYSQL_DATABASE=treino

# Configuração do servidor: utf8mb4, timestamps em UTC e resolução de nomes
# desativada (os containers se falam pelo nome do serviço no compose).
COPY my.cnf /etc/mysql/conf.d/treino.cnf

# Executados em ordem alfabética: 01-schema.sql antes de 02-seed.sql.
COPY init/ /docker-entrypoint-initdb.d/

RUN chmod 644 /etc/mysql/conf.d/treino.cnf /docker-entrypoint-initdb.d/*.sql

# Volume com os arquivos do InnoDB. O compose usa o volume nomeado
# "mysql-data", então os registros sobrevivem a restart/rebuild.
VOLUME ["/var/lib/mysql"]
EXPOSE 3306

# Ping via TCP: durante a inicialização o servidor temporário roda com
# --skip-networking, então só responde quando o banco está realmente pronto.
# (mysqladmin ping retorna 0 mesmo com "Access denied", pois o servidor está no ar.)
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=12 \
  CMD mysqladmin ping -h 127.0.0.1 --silent || exit 1
