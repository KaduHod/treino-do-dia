-- ---------------------------------------------------------------------------
-- Treino do Dia — schema inicial (MySQL 8.4)
--
-- Guarda os mesmos dados que hoje vivem em data/workouts.json (dias de treino
-- e exercícios registrados), mas normalizados e vinculados a um usuário.
--
-- O usuário "default" (id 1, ver 02-seed.sql) mantém o comportamento atual de
-- uso pessoal. Quando o login existir, cada usuário passa a ter seus próprios
-- dias/registros sem precisar alterar as tabelas.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS treino
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE treino;

-- ---------------------------------------------------------------------------
-- Usuários (base para a futura autenticação)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)     NOT NULL COMMENT 'Identificador de login (único)',
  email         VARCHAR(254)    NULL     COMMENT 'E-mail opcional; único quando informado',
  password_hash VARCHAR(255)    NULL     COMMENT 'Hash da senha (NULL enquanto não há login)',
  display_name  VARCHAR(100)    NOT NULL DEFAULT '' COMMENT 'Nome exibido na interface',
  is_active     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_is_active CHECK (is_active IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Usuários do app';

-- ---------------------------------------------------------------------------
-- Dias de treino: um registro por usuário/data (equivale a database[date])
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workouts (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  workout_date DATE            NOT NULL COMMENT 'Dia do treino (YYYY-MM-DD)',
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_workouts_user_date (user_id, workout_date),
  CONSTRAINT fk_workouts_user
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Um dia de treino por usuário';

-- ---------------------------------------------------------------------------
-- Exercícios registrados no dia (equivale a workouts[date].entries[])
--
-- exercise_name é um snapshot do nome vindo da API externa, para o histórico
-- continuar legível mesmo se a API mudar. A unicidade (workout_id, exercise_id)
-- reproduz a regra atual: adicionar o mesmo exercício no dia atualiza o registro.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workout_entries (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workout_id    BIGINT UNSIGNED NOT NULL,
  exercise_id   INT UNSIGNED    NOT NULL COMMENT 'ID do exercício na API externa',
  exercise_name VARCHAR(150)    NOT NULL DEFAULT '' COMMENT 'Nome do exercício no momento do registro',
  reps          VARCHAR(24)     NOT NULL DEFAULT '3x12' COMMENT 'Ex.: 3x12, 3 x 10-12 ou 12',
  weight_kg     DECIMAL(6,2)    NOT NULL DEFAULT 0.00,
  done          TINYINT(1)      NOT NULL DEFAULT 1,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_entries_workout_exercise (workout_id, exercise_id),
  KEY idx_entries_exercise (exercise_id),
  CONSTRAINT fk_entries_workout
    FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE,
  CONSTRAINT chk_entries_weight CHECK (weight_kg >= 0 AND weight_kg <= 1000),
  CONSTRAINT chk_entries_done CHECK (done IN (0, 1))
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Exercícios registrados em um dia de treino';
