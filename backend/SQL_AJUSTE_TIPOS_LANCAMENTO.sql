-- Ajuste do cadastro oficial de tipos de lançamento.
-- O backend também executa estas alterações automaticamente ao iniciar,
-- mas este SQL pode ser usado manualmente no phpMyAdmin se desejar.

ALTER TABLE tipos_lancamento
  ADD COLUMN IF NOT EXISTS considera_resumo_dia TINYINT(1) NOT NULL DEFAULT 1 AFTER ordem_relatorio,
  ADD COLUMN IF NOT EXISTS considera_relatorio_periodo TINYINT(1) NOT NULL DEFAULT 1 AFTER considera_resumo_dia;

-- Tipos estruturais que não devem participar dos resumos por padrão.
UPDATE tipos_lancamento
   SET considera_resumo_dia = 0,
       considera_relatorio_periodo = 0
 WHERE UPPER(codigo) IN ('SALDO', 'TRANSFERENCIA', 'SEP_VENDAS');
