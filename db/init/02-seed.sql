-- ---------------------------------------------------------------------------
-- Seed: usuário padrão do modo single-user.
--
-- Enquanto não existe login, o app usa este usuário (id 1) como dono dos
-- treinos. Quando a autenticação chegar, usuários reais passam a ser criados
-- na mesma tabela e o "default" pode ser desativado ou migrado.
-- ---------------------------------------------------------------------------

USE treino;

INSERT INTO users (id, username, display_name)
VALUES (1, 'default', 'Usuário padrão')
ON DUPLICATE KEY UPDATE id = id;
